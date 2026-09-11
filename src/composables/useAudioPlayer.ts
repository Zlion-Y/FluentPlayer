import { ref, computed, nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { ReadCoverArt, AudioSrc } from '@bridge/app'
import { type Song } from '../types'
import { localMetadata } from './useLocalMetadata'
import { resolveOnlineUrl, resolveOnlinePic, activeQuality, setPreferredQuality } from '@online/player'
import type { Quality } from '@online/types/music'
import { toast } from './useToast'

interface AudioPlayerOptions {
  audioRef?: Ref<HTMLAudioElement | null>
  onEnded?: () => void
  /** 当前歌曲加载/播放失败（在线解析失败、本地文件损坏等）时触发，用于自动切到下一首。 */
  onPlayError?: () => void
}

export function useAudioPlayer(options: AudioPlayerOptions = {}) {
  const internalAudioRef = ref<HTMLAudioElement | null>(null)
  const audioRef = options.audioRef || internalAudioRef
  const currentSong = ref<Song | null>(null)
  const isPlaying = ref(false)
  // 播放加载态：在线直链解析 / 音频缓冲期间为 true，底部播放按钮显示加载动画
  const isLoading = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const savedVolume = (() => {
    const saved = localStorage.getItem('fp-volume')
    const n = saved ? parseInt(saved, 10) : NaN
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100
  })()
  const volume = ref(savedVolume)
  const playbackRate = ref(1)
  const coverUrl = ref<string | null>(null)
  // 播放列表（与歌单解耦的播放队列）
  const queue = ref<Song[]>([])
  const index = ref(-1)
  // 上下文标签（用于展示/恢复），不再用于队列导航
  const playlistId = ref<string | null>(null)

  // 播放会话令牌：每次 playLocal 递增。快速切歌时，旧歌残留的异步回调
  // （解析结果 / play() 完成或失败）通过比对令牌被丢弃，不再污染新歌状态。
  let playToken = 0
  // 当前 token 的失败只处理一次（play() 拒绝与 error 事件可能同时到来）
  let failureHandledToken = -1
  // 连续失败计数：整队失败时停止自动跳歌，避免死循环刷接口
  let consecutiveFailures = 0
  // 当前 token 是否已成功出过声（用于区分“播放中途流断开”与“起播即失败”）
  let currentPlaySucceeded = false

  const hasSong = computed(() => currentSong.value !== null)

  /** 当前歌曲播放失败：节流后回调自动跳下一首。 */
  function handlePlayFailure(token: number) {
    if (token !== playToken || failureHandledToken === token) return
    failureHandledToken = token
    isLoading.value = false
    isPlaying.value = false
    consecutiveFailures += 1
    const cap = Math.max(1, Math.min(5, queue.value.length))
    if (!options.onPlayError) return
    if (consecutiveFailures > cap) {
      if (consecutiveFailures === cap + 1) {
        toast(`连续 ${cap} 首播放失败，已停止自动切歌`, 'warning')
      }
      return
    }
    options.onPlayError()
  }

  async function loadCover(path: string) {
    const override = localMetadata.value[path]?.cover
    if (override) {
      coverUrl.value = override
      return
    }
    try {
      coverUrl.value = await ReadCoverArt(path)
    } catch {
      coverUrl.value = null
    }
  }

  watch(() => localMetadata.value[currentSong.value?.path ?? '']?.cover, () => {
    if (currentSong.value && !currentSong.value.online) loadCover(currentSong.value.path)
  })

  // 播放歌曲（本地文件或在线歌曲）
  async function playLocal(song: Song, autoPlay = true) {
    // 切换歌曲：先清空上一首的播放状态（进度/时长），并进入加载态
    const token = ++playToken
    currentPlaySucceeded = false
    currentSong.value = song
    currentTime.value = 0
    duration.value = song.metadata?.duration || 0
    isPlaying.value = false
    isLoading.value = true

    if (song.online) {
      // 在线歌曲：封面直接用 URL，播放直链异步解析
      coverUrl.value = song.cover ?? null
      if (!coverUrl.value) {
        resolveOnlinePic(song.online).then((url) => {
          if (token === playToken && currentSong.value?.id === song.id && url) coverUrl.value = url
        })
      }
      await nextTick()
      if (token !== playToken || !audioRef.value) return
      try {
        const { url, quality } = await resolveOnlineUrl(song.online)
        // 解析期间用户可能已切歌
        if (token !== playToken || currentSong.value?.id !== song.id || !audioRef.value) return
        activeQuality.value = quality
        audioRef.value.src = url
        audioRef.value.load()
        audioRef.value.playbackRate = playbackRate.value
        if (autoPlay) {
          await audioRef.value.play()
          if (token !== playToken) return
          isPlaying.value = true
        } else {
          isPlaying.value = false
        }
        // 加载态在音频真正可播放（canplay/playing）时由 bindAudioEvents 清除
      } catch (err) {
        // 切歌引发的 abort / 过期失败：不提示、不跳歌、不清新歌的加载态
        if (token !== playToken) return
        const msg = (err as Error).message || ''
        const noSource = msg.includes('没有可用的自定义音源') || msg.includes('noEnabled')
        if (noSource) {
          // 仅提示，不再强制跳转音源界面（避免有音源或初始化期间误跳）。
          // 用户可在在线页面右上角「音源」自行导入。
          toast('没有可用的自定义音源，请在在线页面右上角「音源」中导入音源脚本', 'warning')
        } else {
          toast(autoPlay ? `在线播放失败，已自动切换：${msg}` : `在线加载失败：${msg}`, 'error')
        }
        if (autoPlay) handlePlayFailure(token)
        else isLoading.value = false
      }
      return
    }

    activeQuality.value = null
    await loadCover(song.path)
    await nextTick()
    if (token !== playToken || !audioRef.value) return
    try {
      audioRef.value.src = AudioSrc(song.path)
      audioRef.value.load()
      audioRef.value.playbackRate = playbackRate.value
      if (autoPlay) {
        await audioRef.value.play()
        if (token !== playToken) return
        isPlaying.value = true
      } else {
        isPlaying.value = false
      }
    } catch {
      // 本地文件缺失 / 损坏：旧实现静默吞掉导致“切歌没反应”，这里自动跳下一首
      if (token !== playToken) return
      if (autoPlay) handlePlayFailure(token)
      else { isPlaying.value = false; isLoading.value = false }
    } finally {
      // 本地文件：play() 完成后即结束加载态（缓冲事件会继续由 canplay 处理）
      if (token === playToken && audioRef.value && audioRef.value.readyState >= 3) isLoading.value = false
    }
  }

  // 切换音质：设置偏好并重新解析当前在线歌曲（保留进度续播）
  async function changeQuality(q: Quality) {
    setPreferredQuality(q)
    const song = currentSong.value
    if (!song?.online || !audioRef.value) return
    const token = playToken
    const keepTime = audioRef.value.currentTime
    const wasPlaying = isPlaying.value
    try {
      const { url, quality } = await resolveOnlineUrl(song.online)
      // 解析期间用户切歌则丢弃结果，避免旧直链覆盖新歌
      if (token !== playToken || currentSong.value?.id !== song.id || !audioRef.value) return
      activeQuality.value = quality
      audioRef.value.src = url
      audioRef.value.load()
      audioRef.value.currentTime = keepTime
      audioRef.value.playbackRate = playbackRate.value
      if (wasPlaying) {
        await audioRef.value.play()
        isPlaying.value = true
      }
    } catch (err) {
      if (token !== playToken) return
      toast(`切换音质失败：${(err as Error).message || ''}`, 'error')
    }
  }

  // 播放队列中第 i 首
  async function playQueueAt(i: number, autoPlay = true) {
    const song = queue.value[i]
    if (!song) return
    index.value = i
    await playLocal(song, autoPlay)
  }

  // 替换播放列表：用 songs 替换整个队列并从 startIndex 开始播放
  async function playSongs(songs: Song[], startIndex: number, context?: string | null, autoPlay = true) {
    queue.value = songs
    playlistId.value = context ?? null
    await playQueueAt(startIndex, autoPlay)
  }

  // 添加到播放列表：追加到队尾，若当前未播放则立即播放
  function addToQueue(song: Song) {
    if (queue.value.length && queue.value[queue.value.length - 1]?.id === song.id) return
    queue.value = [...queue.value, song]
    if (index.value < 0 && !currentSong.value) {
      playQueueAt(queue.value.length - 1, true)
    }
  }

  // 从播放列表删除第 i 首，自动维护 index
  function removeFromQueue(i: number) {
    if (i < 0 || i >= queue.value.length) return
    const wasCurrent = i === index.value
    queue.value = queue.value.filter((_, idx) => idx !== i)
    if (i < index.value) {
      index.value = index.value - 1
    } else if (wasCurrent) {
      if (queue.value.length === 0) {
        index.value = -1
        currentSong.value = null
        isPlaying.value = false
        isLoading.value = false
        audioRef.value?.pause()
      } else {
        const nextIdx = Math.min(i, queue.value.length - 1)
        playQueueAt(nextIdx, isPlaying.value)
      }
    }
  }

  function clearQueue() {
    queue.value = []
    index.value = -1
    currentSong.value = null
    isPlaying.value = false
    isLoading.value = false
    audioRef.value?.pause()
  }

  function togglePlay() {
    if (!currentSong.value || !audioRef.value) return
    if (isPlaying.value) {
      audioRef.value.pause()
    } else {
      // 从暂停恢复：若音频未就绪，进入加载态直到 canplay
      if (audioRef.value.readyState < 3) isLoading.value = true
      audioRef.value.play().catch(() => {})
    }
  }

  function pause() {
    audioRef.value?.pause()
  }

  function seek(time: number) {
    if (!audioRef.value) return
    audioRef.value.currentTime = time
    currentTime.value = time
  }

  function setVolume(value: number) {
    const v = Math.min(100, Math.max(0, Math.round(value)))
    volume.value = v
    if (audioRef.value) audioRef.value.volume = v / 100
    localStorage.setItem('fp-volume', String(v))
  }

  function setPlaybackRate(rate: number) {
    const clamped = Math.min(16, Math.max(0.25, rate))
    playbackRate.value = clamped
    if (audioRef.value) audioRef.value.playbackRate = clamped
  }

  function bindAudioEvents() {
    const audio = audioRef.value
    if (!audio) return
    audio.volume = volume.value / 100
    audio.addEventListener('timeupdate', () => {
      currentTime.value = audio.currentTime || 0
    })
    audio.addEventListener('loadedmetadata', () => {
      duration.value = audio.duration || currentSong.value?.metadata?.duration || 0
    })
    if (options.onEnded) {
      audio.addEventListener('ended', options.onEnded)
    }
    audio.addEventListener('play', () => { isPlaying.value = true })
    audio.addEventListener('pause', () => { isPlaying.value = false })
    // 音频缓冲就绪：清除加载态（在线直链解析完成 / 本地缓冲完成）
    audio.addEventListener('canplay', () => { isLoading.value = false })
    audio.addEventListener('playing', () => {
      isLoading.value = false
      // 成功出声：重置连续失败计数，当前 token 视为已成功起播
      consecutiveFailures = 0
      currentPlaySucceeded = true
    })
    audio.addEventListener('error', () => {
      isLoading.value = false
      // 起播阶段的失败由 playLocal 的 play() 拒绝路径处理；
      // 这里只处理“播放中途流断开/链接失效”：确属当前歌且已成功出过声才自动跳下一首。
      if (currentPlaySucceeded && options.onPlayError) handlePlayFailure(playToken)
    })
  }

  onMounted(() => {
    nextTick(bindAudioEvents)
  })

  onUnmounted(() => {
    audioRef.value?.pause()
  })

  return {
    audioRef,
    currentSong,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    playbackRate,
    coverUrl,
    queue,
    index,
    playlistId,
    hasSong,
    playSongs,
    playQueueAt,
    addToQueue,
    removeFromQueue,
    clearQueue,
    togglePlay,
    pause,
    seek,
    setVolume,
    setPlaybackRate,
    changeQuality,
  }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import './App.css'

type VisualizationId = 'rgb' | 'infrared' | 'uv' | 'falseColor' | 'xray' | 'iiif'
type CompareSourceId = VisualizationId | 'band'
type CompareMode = 'single' | 'curtain' | 'split' | 'quad' | 'focusQuad' | 'overlay'
type Screen = 'standby' | 'collection' | 'viewer'
type ToolPanel = 'artwork' | 'visualization' | 'compare'
type BandControlPlacement = 'overlay' | 'below'
type ViewerTileSource = OpenSeadragon.TileSourceSpecifier | string | { type: 'image'; url: string }
type NormalizedImagePoint = { x: number; y: number }
type NormalizedImageView = { x: number; y: number; width: number; height: number }
type SharedViewerState = {
  artworkId: string
  selectedVisualization: VisualizationId
  compareMode: CompareMode
  curtainLeftViz: CompareSourceId
  curtainRightViz: CompareSourceId
  splitLeftViz: CompareSourceId
  splitRightViz: CompareSourceId
  overlayViz: CompareSourceId
  overlayBaseViz: CompareSourceId
  quadVizIds: CompareSourceId[]
  comparisonBandIndices: number[]
  activeBandPane: number
  linkBands: boolean
  overlayOpacity: number
  syncZoom: boolean
  linkedPointer: boolean
  showCompareLabels: boolean
  pointerPosition: NormalizedImagePoint | null
  curtainPosition: number
  focusQuadPosition: NormalizedImagePoint
  imageView: NormalizedImageView | null
}

const visualizationIds: VisualizationId[] = ['rgb', 'infrared', 'uv', 'falseColor', 'xray', 'iiif']
const compareModeIds: CompareMode[] = ['single', 'curtain', 'split', 'quad', 'focusQuad', 'overlay']

function parseSharedViewerState(search: string): SharedViewerState | null {
  const encoded = new URLSearchParams(search).get('view')
  if (!encoded) return null

  try {
    const value = JSON.parse(encoded) as Partial<SharedViewerState>
    if (typeof value.artworkId !== 'string' || !value.artworkId) return null
    const viz = (candidate: unknown, fallback: VisualizationId): VisualizationId =>
      typeof candidate === 'string' && visualizationIds.includes(candidate as VisualizationId)
        ? candidate as VisualizationId
        : fallback
    const source = (candidate: unknown, fallback: VisualizationId): CompareSourceId =>
      candidate === 'band' ? 'band' : viz(candidate, fallback)
    const mode = compareModeIds.includes(value.compareMode as CompareMode)
      ? value.compareMode as CompareMode
      : 'single'
    const point = value.pointerPosition
    const imageView = value.imageView
    return {
      artworkId: value.artworkId,
      selectedVisualization: viz(value.selectedVisualization, 'rgb'),
      compareMode: mode,
      curtainLeftViz: source(value.curtainLeftViz, 'rgb'),
      curtainRightViz: source(value.curtainRightViz, 'falseColor'),
      splitLeftViz: source(value.splitLeftViz, 'rgb'),
      splitRightViz: source(value.splitRightViz, 'falseColor'),
      overlayViz: source(value.overlayViz, 'infrared'),
      overlayBaseViz: source(value.overlayBaseViz, 'rgb'),
      quadVizIds: Array.isArray(value.quadVizIds)
        ? value.quadVizIds.slice(0, 4).map((id) => source(id, 'rgb'))
        : ['rgb', 'infrared', 'falseColor', 'xray'],
      comparisonBandIndices: Array.isArray(value.comparisonBandIndices)
        ? value.comparisonBandIndices.slice(0, 4).map((index) => Math.max(0, Math.floor(Number(index) || 0)))
        : [0, 0, 0, 0],
      activeBandPane: Number.isInteger(value.activeBandPane) ? Math.min(3, Math.max(0, Number(value.activeBandPane))) : 0,
      linkBands: value.linkBands === true,
      overlayOpacity: Number.isFinite(value.overlayOpacity)
        ? Math.min(1, Math.max(0, Number(value.overlayOpacity)))
        : 0.5,
      syncZoom: value.syncZoom !== false,
      linkedPointer: value.linkedPointer === true,
      showCompareLabels: value.showCompareLabels !== false,
      pointerPosition: point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? { x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) }
        : null,
      curtainPosition: Number.isFinite(value.curtainPosition)
        ? Math.min(98, Math.max(2, Number(value.curtainPosition)))
        : 50,
      focusQuadPosition: value.focusQuadPosition && Number.isFinite(value.focusQuadPosition.x) && Number.isFinite(value.focusQuadPosition.y)
        ? { x: Math.min(0.95, Math.max(0.05, value.focusQuadPosition.x)), y: Math.min(0.95, Math.max(0.05, value.focusQuadPosition.y)) }
        : { x: 0.5, y: 0.5 },
      imageView: imageView && [imageView.x, imageView.y, imageView.width, imageView.height].every(Number.isFinite)
        ? {
            x: Number(imageView.x),
            y: Number(imageView.y),
            width: Math.max(0.001, Number(imageView.width)),
            height: Math.max(0.001, Number(imageView.height)),
          }
        : null,
    }
  } catch {
    return null
  }
}

function captureImageView(viewer: OpenSeadragon.Viewer | null): NormalizedImageView | null {
  const item = viewer?.world.getItemAt(0)
  if (!viewer?.viewport || !item) return null
  const dimensions = item.source.dimensions
  if (!dimensions.x || !dimensions.y) return null
  const imageBounds = item.viewportToImageRectangle(viewer.viewport.getBounds(true))
  return {
    x: (imageBounds.x + imageBounds.width / 2) / dimensions.x,
    y: (imageBounds.y + imageBounds.height / 2) / dimensions.y,
    width: imageBounds.width / dimensions.x,
    height: imageBounds.height / dimensions.y,
  }
}

type Visualization = {
  id: VisualizationId
  label: string
  tone: string
  description: string
}

type VisualizationAsset = {
  id: VisualizationId
  label: string
  tone: string
  description: string
  available: boolean
  sourceType: 'iiif' | 'dzi' | 'image' | 'generated' | 'band'
  tileSource?: string | null
  imageUrl?: string | null
}

type BandImage = {
  bandIndex: number
  wavelength?: number | null
  imageUrl: string
}

type Artwork = {
  id: string
  title: string
  artist: string
  year: string
  collection: string
  thumbnail: string
  hero: string
  iiifSources?: Partial<Record<VisualizationId, ViewerTileSource>>
  visualizations?: Visualization[]
  visualizationAssets?: Partial<Record<VisualizationId, VisualizationAsset>>
  bandImages?: BandImage[]
}

type BackendDataset = {
  id: string
  title: string
  artist?: string
  year?: string
  collection?: string
  thumbnail: string
  hero: string
  availableVisualizations?: string[]
}

type BackendDatasetDetail = {
  id: string
  title: string
  artist?: string
  year?: string
  collection?: string
  thumbnail: string
  hero: string
  iiifSources?: Partial<Record<VisualizationId, string>>
  visualizations?: {
    id: VisualizationId
    label: string
    tone: string
    description: string
    available: boolean
    sourceType: 'iiif' | 'dzi' | 'image' | 'generated' | 'band'
    tileSource?: string | null
    imageUrl?: string | null
  }[]
  bands?: {
    enabled: boolean
    minNm: number
    maxNm: number
    stepNm: number
    defaultNm: number
    previewImages?: string[]
    items?: {
      bandIndex: number
      wavelength?: number | null
      imageUrl: string
    }[]
  } | null
}


const visualizationDefinitions: Record<VisualizationId, Visualization> = {
  rgb: {
    id: 'rgb',
    label: 'RGB',
    tone: 'rgb',
    description: 'Standard visible-light documentation view.',
  },
  infrared: {
    id: 'infrared',
    label: 'Infrared',
    tone: 'infrared',
    description: 'Infrared reflectography view for underdrawing and tonal changes.',
  },
  uv: {
    id: 'uv',
    label: 'UV',
    tone: 'uv',
    description: 'Ultraviolet fluorescence view for varnish, retouching, and surface response.',
  },
  falseColor: {
    id: 'falseColor',
    label: 'False Color',
    tone: 'false',
    description: 'Composite false-colour rendering used to compare material response.',
  },
  xray: {
    id: 'xray',
    label: 'X-ray',
    tone: 'xray',
    description: 'X-radiography view for structural and compositional changes.',
  },
  iiif: {
    id: 'iiif',
    label: 'IIIF',
    tone: 'rgb',
    description: 'IIIF deep-zoom tile source for high-resolution tiled viewing.',
  },
}

const backendHost = window.location.hostname || '127.0.0.1'
const backendBaseUrl = `http://${backendHost}:8000`
const iiifBaseUrl = import.meta.env.VITE_IIIF_BASE_URL?.trim().replace(/\/$/, '') || `http://${backendHost}:8182`
const backendDatasetsUrl = `${backendBaseUrl}/public/datasets`
const backendDatasetDetailUrl = (datasetId: string) => `${backendBaseUrl}/public/datasets/${datasetId}`
const inactivityTimeoutMs = 90_000

const resolveBackendAssetUrl = (url: string) => {
  if (url.startsWith('/iiif/')) return `${iiifBaseUrl}${url}`
  if (url.startsWith('/derived/') || url.startsWith('/collection/')) {
    return `${backendBaseUrl}${url}`
  }
  return url
}

const compareModes: { id: CompareMode; label: string }[] = [
  { id: 'single', label: 'Single' },
  { id: 'curtain', label: 'Curtain' },
  { id: 'split', label: 'Split' },
  { id: 'quad', label: 'Quad' },
  { id: 'focusQuad', label: 'Focus Quad' },
  { id: 'overlay', label: 'Overlay' },
]

const toolPanels: { id: ToolPanel; label: string; shortLabel: string }[] = [
  { id: 'artwork', label: 'Artwork', shortLabel: 'Art' },
  { id: 'visualization', label: 'Visualization', shortLabel: 'Viz' },
  { id: 'compare', label: 'Compare', shortLabel: 'Compare' },
]

const visualizationOrder: VisualizationId[] = ['rgb', 'falseColor', 'infrared', 'uv', 'xray']


// ── Helpers ──────────────────────────────────────────────────────────────────
function toOsdTileSource(
  asset: VisualizationAsset | undefined,
  fallbackUrl: string,
): ViewerTileSource {
  if (asset?.available && asset?.tileSource) {
    // IIIF: tileSource is a plain info.json URL string — pass directly, OSD auto-detects
    if (typeof asset.tileSource === 'string') {
      return asset.tileSource as unknown as OpenSeadragon.TileSourceSpecifier
    }
    return asset.tileSource as OpenSeadragon.TileSourceSpecifier
  }
  const url = (asset?.available && asset?.imageUrl) ? asset.imageUrl : fallbackUrl
  return { type: 'image', url } as unknown as OpenSeadragon.TileSourceSpecifier
}

// ── OSD Viewer (always uses OpenSeadragon — no plain img fallback) ────────────
type OpenSeadragonViewerProps = {
  tileSource: ViewerTileSource
  fallbackUrl?: string
  label?: string
  onViewerReady?: (viewer: OpenSeadragon.Viewer) => void
  linkedPointer?: boolean
  pointerPosition?: NormalizedImagePoint | null
  onPointerPositionChange?: (position: NormalizedImagePoint) => void
  initialImageView?: NormalizedImageView | null
  allowPan?: boolean
}

function OpenSeadragonViewer({
  tileSource,
  fallbackUrl,
  label,
  onViewerReady,
  linkedPointer = false,
  pointerPosition = null,
  onPointerPositionChange,
  initialImageView = null,
  allowPan = true,
}: OpenSeadragonViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const pendingSourceRef = useRef<ViewerTileSource | null>(null)
  const initializedRef = useRef(false)
  const [viewerReady, setViewerReady] = useState(false)
  const [pointerPixel, setPointerPixel] = useState<NormalizedImagePoint | null>(null)
  const linkedPointerRef = useRef(linkedPointer)
  const pointerPositionRef = useRef(pointerPosition)
  const onPointerPositionChangeRef = useRef(onPointerPositionChange)
  linkedPointerRef.current = linkedPointer
  pointerPositionRef.current = pointerPosition
  onPointerPositionChangeRef.current = onPointerPositionChange
  const currentSourceRef = useRef(tileSource)
  const fallbackUrlRef = useRef(fallbackUrl)
  const fallbackAttemptedRef = useRef(false)
  currentSourceRef.current = tileSource
  fallbackUrlRef.current = fallbackUrl
  const tileSourceKey = typeof tileSource === 'string' ? tileSource : JSON.stringify(tileSource)

  useEffect(() => {
    fallbackAttemptedRef.current = false
  }, [tileSourceKey])

  // OpenSeadragon detects IIIF from its info.json URL when given the URL directly.
  const normaliseTileSource = (src: ViewerTileSource): OpenSeadragon.TileSourceSpecifier => {
    if (typeof src === 'string') {
      if (src.endsWith('.dzi') || src.endsWith('/info.json')) return src as unknown as OpenSeadragon.TileSourceSpecifier
      return { type: 'image', url: src } as unknown as OpenSeadragon.TileSourceSpecifier
    }
    return src as OpenSeadragon.TileSourceSpecifier
  }

  // Initialize OSD only once the container has non-zero dimensions
  const initViewer = (el: HTMLDivElement, source: ViewerTileSource) => {
    if (initializedRef.current && viewerRef.current) {
      const viewer = viewerRef.current
      const currentZoom = viewer.viewport?.getZoom(true)
      const currentCenter = viewer.viewport?.getCenter(true)
      // Debounce: cancel any pending open, wait 80ms so rapid slider drags
      // don't trigger a black-flash reload on every pixel move
      if ((viewer as any)._bandDebounce) clearTimeout((viewer as any)._bandDebounce)
      ;(viewer as any)._bandDebounce = setTimeout(() => {
        viewer.open(normaliseTileSource(source))
        viewer.addOnceHandler('open', () => {
          if (currentZoom != null && currentCenter) {
            viewer.viewport?.zoomTo(currentZoom, undefined, true)
            viewer.viewport?.panTo(currentCenter, true)
          }
          viewer.forceRedraw()
        })
      }, 80)
      return
    }
    viewerRef.current = OpenSeadragon({
      element: el,
      prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1/build/openseadragon/images/',
      showNavigator: false,
      showRotationControl: false,
      showFullPageControl: false,
      zoomInButton: undefined,
      zoomOutButton: undefined,
      homeButton: undefined,
      showHomeControl: false,
      showZoomControl: false,
      gestureSettingsTouch: {
        pinchToZoom: true,
        flickEnabled: true,
        dragToPan: allowPan,
        clickToZoom: true,
        dblClickToZoom: true,
      },
      preserveViewport: false,
      visibilityRatio: 0.5,
      constrainDuringPan: false,
      minZoomImageRatio: 0.5,
      maxZoomPixelRatio: 20,
      zoomPerScroll: 1.3,
      springStiffness: 8,
      gestureSettingsMouse: {
        scrollToZoom: true,
        zoomToRefPoint: true,
        dragToPan: allowPan,
      },
      crossOriginPolicy: 'Anonymous',
      animationTime: 0.18,
      blendTime: 0.1,
      immediateRender: true,
    })
    const updateLinkedPointer = (event: PointerEvent) => {
      if (!linkedPointerRef.current || !onPointerPositionChangeRef.current) return
      const viewer = viewerRef.current
      const item = viewer?.world.getItemAt(0)
      if (!viewer || !item) return
      const rect = el.getBoundingClientRect()
      const pixelPoint = new OpenSeadragon.Point(event.clientX - rect.left, event.clientY - rect.top)
      const viewportPoint = viewer.viewport.pointFromPixel(pixelPoint, true)
      const imagePoint = item.viewportToImageCoordinates(viewportPoint, true)
      const dimensions = item.source.dimensions
      if (!dimensions.x || !dimensions.y) return
      const x = imagePoint.x / dimensions.x
      const y = imagePoint.y / dimensions.y
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        onPointerPositionChangeRef.current({ x, y })
      }
    }
    // Observe pointer events in the capture phase. OpenSeadragon's MouseTracker
    // may stop bubbling events from its canvas, and curtain mode clips each
    // full-size viewer layer. Capture lets us see the event while its composed
    // path still identifies the visible/source viewer.
    const updateFromVisibleViewer = (event: PointerEvent) => {
      if (!event.composedPath().includes(el)) return
      updateLinkedPointer(event)
    }
    window.addEventListener('pointermove', updateFromVisibleViewer, { capture: true, passive: true })
    window.addEventListener('pointerdown', updateFromVisibleViewer, { capture: true, passive: true })
    viewerRef.current.addHandler('before-destroy', () => {
      window.removeEventListener('pointermove', updateFromVisibleViewer, true)
      window.removeEventListener('pointerdown', updateFromVisibleViewer, true)
    })
    viewerRef.current.addHandler('open-failed', () => {
      const sourceNow = currentSourceRef.current
      const fallbackNow = fallbackUrlRef.current
      if (fallbackAttemptedRef.current || !fallbackNow || typeof sourceNow !== 'string') return
      fallbackAttemptedRef.current = true
      viewerRef.current?.open({ type: 'image', url: fallbackNow } as unknown as OpenSeadragon.TileSourceSpecifier)
    })
    initializedRef.current = true
    viewerRef.current.open(normaliseTileSource(source))
    viewerRef.current.addOnceHandler('open', () => {
      setTimeout(() => {
        const viewer = viewerRef.current
        viewer?.viewport?.goHome(true)
        const item = viewer?.world.getItemAt(0)
        if (viewer && item && initialImageView) {
          const dimensions = item.source.dimensions
          const width = Math.min(1, Math.max(0.001, initialImageView.width)) * dimensions.x
          const height = Math.min(1, Math.max(0.001, initialImageView.height)) * dimensions.y
          const x = Math.min(dimensions.x - width, Math.max(0, initialImageView.x * dimensions.x - width / 2))
          const y = Math.min(dimensions.y - height, Math.max(0, initialImageView.y * dimensions.y - height / 2))
          const imageRect = item.imageToViewportRectangle(x, y, width, height)
          viewer.viewport?.fitBounds(imageRect, true)
          viewer.viewport?.applyConstraints(true)
        }
        viewer?.forceRedraw()
        if (viewer) {
          setViewerReady(true)
          onViewerReady?.(viewer)
        }
      }, 50)
    })
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // If already has size, init immediately
    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      initViewer(el, tileSource)
      return
    }

    // Otherwise wait until the container has real dimensions
    pendingSourceRef.current = tileSource
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          ro.disconnect()
          const source = pendingSourceRef.current
          if (source) {
            pendingSourceRef.current = null
            initViewer(el, source)
          }
          break
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileSourceKey])

  useEffect(() => {
    return () => {
      viewerRef.current?.destroy()
      viewerRef.current = null
      initializedRef.current = false
    }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    const item = viewer?.world.getItemAt(0)
    if (!viewer || !item || !viewerReady || !linkedPointer || !pointerPosition) {
      setPointerPixel(null)
      return
    }
    const updatePointerPosition = () => {
      const currentItem = viewer.world.getItemAt(0)
      if (!currentItem) return
      const dimensions = currentItem.source.dimensions
      const point = currentItem.imageToViewerElementCoordinates(
        new OpenSeadragon.Point(pointerPosition.x * dimensions.x, pointerPosition.y * dimensions.y),
      )
      const size = viewer.viewport.getContainerSize()
      setPointerPixel(
        point.x >= 0 && point.x <= size.x && point.y >= 0 && point.y <= size.y
          ? { x: point.x, y: point.y }
          : null,
      )
    }
    viewer.addHandler('viewport-change', updatePointerPosition)
    updatePointerPosition()
    return () => viewer.removeHandler('viewport-change', updatePointerPosition)
  }, [linkedPointer, pointerPosition?.x, pointerPosition?.y, viewerReady, tileSourceKey])

  return (
    <div className="osd-viewer-root" style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} className="osd-container" aria-label={label ?? 'Deep zoom viewer'} />
      {linkedPointer && pointerPosition && pointerPixel && (
        <div className="linked-pointer-layer" aria-hidden="true">
          <div className="linked-pointer-mark" style={{ left: pointerPixel.x, top: pointerPixel.y }} />
        </div>
      )}
    </div>
  )
}

// ── Curtain Compare (draggable divider over two OSD instances) ────────────────
// Module-level sync utility — reused by Curtain, Split, and Overlay
// Syncs viewport bounds (zoom+pan together) to avoid origin drift
function syncOsdViewers(
  source: OpenSeadragon.Viewer,
  target: OpenSeadragon.Viewer,
  guard: React.MutableRefObject<boolean>,
): () => void {
  const handler = () => {
    if (guard.current) return
    if (!source.viewport || !target.viewport) return
    guard.current = true
    const bounds = source.viewport.getBounds(true)
    target.viewport.fitBounds(bounds, true)
    target.viewport.applyConstraints(true)
    guard.current = false
  }
  source.addHandler('viewport-change', handler)
  // return cleanup so callers can removeHandler
  return () => source.removeHandler('viewport-change', handler)
}

// Wire sync between two viewers — safe to call before both are ready
// keeps retrying until both refs are populated
function wireSyncWhenReady(
  refA: React.MutableRefObject<OpenSeadragon.Viewer | null>,
  refB: React.MutableRefObject<OpenSeadragon.Viewer | null>,
  guard: React.MutableRefObject<boolean>,
  onCleanup: (fn: () => void) => void,
) {
  let cancelled = false
  let timer: number | null = null
  const attempt = (tries = 0) => {
    if (cancelled) return
    if (refA.current && refB.current) {
      const c1 = syncOsdViewers(refA.current, refB.current, guard)
      const c2 = syncOsdViewers(refB.current, refA.current, guard)
      onCleanup(c1)
      onCleanup(c2)
    } else if (tries < 20) {
      timer = window.setTimeout(() => attempt(tries + 1), 100)
    }
  }
  onCleanup(() => {
    cancelled = true
    if (timer !== null) window.clearTimeout(timer)
  })
  attempt()
}

type CurtainViewerProps = {
  leftSource: ViewerTileSource
  rightSource: ViewerTileSource
  leftLabel: string
  rightLabel: string
  fallbackUrl: string
  syncZoom?: boolean
  onAnyViewerReady?: (v: OpenSeadragon.Viewer) => void
  position: number
  onPositionChange: (position: number) => void
  linkedPointer?: boolean
  pointerPosition?: NormalizedImagePoint | null
  onPointerPositionChange?: (position: NormalizedImagePoint) => void
  initialImageView?: NormalizedImageView | null
}

function CurtainViewer({
  leftSource,
  rightSource,
  leftLabel,
  rightLabel,
  fallbackUrl,
  syncZoom,
  onAnyViewerReady,
  position,
  onPositionChange,
  linkedPointer,
  pointerPosition,
  onPointerPositionChange,
  initialImageView,
}: CurtainViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const leftViewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const rightViewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const isDragging = useRef(false)
  const isSyncing = useRef(false)
  const syncCleanupsRef = useRef<(() => void)[]>([])
  const syncZoomRef = useRef(syncZoom)
  syncZoomRef.current = Boolean(syncZoom)

  const connectSyncedViewers = () => {
    if (!syncZoomRef.current || !leftViewerRef.current || !rightViewerRef.current) return
    syncCleanupsRef.current.forEach((cleanup) => cleanup())
    const c1 = syncOsdViewers(leftViewerRef.current, rightViewerRef.current, isSyncing)
    const c2 = syncOsdViewers(rightViewerRef.current, leftViewerRef.current, isSyncing)
    syncCleanupsRef.current = [c1, c2]
  }

  const getPercent = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return 50
    return Math.min(98, Math.max(2, ((clientX - rect.left) / rect.width) * 100))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    isDragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return
    onPositionChange(getPercent(e.clientX))
  }
  const onPointerUp = () => { isDragging.current = false }

  // Reactive sync — fires whenever syncZoom prop changes
  // Also fires after viewers mount because refs update before this effect re-runs
  useEffect(() => {
    // always clear previous handlers first
    syncCleanupsRef.current.forEach((fn) => fn())
    syncCleanupsRef.current = []
    if (!syncZoom) return
    // both viewers may not be ready yet — poll until they are
    let cancelled = false
    const attempt = (tries = 0) => {
      if (cancelled) return
      if (leftViewerRef.current && rightViewerRef.current) {
        connectSyncedViewers()
      } else if (tries < 30) {
        setTimeout(() => attempt(tries + 1), 100)
      }
    }
    attempt()
    return () => { cancelled = true }
  }, [syncZoom])

  return (
    <div
      ref={containerRef}
      className="curtain-container"
    >
      {/* Left layer — full size, clipped to left portion via clipPath */}
      <div
        className="curtain-layer"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <OpenSeadragonViewer tileSource={leftSource} fallbackUrl={fallbackUrl} label={leftLabel} linkedPointer={linkedPointer} pointerPosition={pointerPosition} onPointerPositionChange={onPointerPositionChange} initialImageView={initialImageView} onViewerReady={(v) => {
          leftViewerRef.current = v
          onAnyViewerReady?.(v)
          connectSyncedViewers()
        }} />
        <div
          className="curtain-pane-label curtain-pane-label-left"
          style={{ left: `calc(${position}% - 12px)`, top: '16px', bottom: 'auto', transform: 'translateX(-100%)', display: position >= 26 ? undefined : 'none' }}
        >{leftLabel}</div>
      </div>

      {/* Right layer — full size, clipped to right portion via clipPath */}
      <div
        className="curtain-layer"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
      >
        <OpenSeadragonViewer tileSource={rightSource} fallbackUrl={fallbackUrl} label={rightLabel} linkedPointer={linkedPointer} pointerPosition={pointerPosition} onPointerPositionChange={onPointerPositionChange} initialImageView={initialImageView} onViewerReady={(v) => {
          rightViewerRef.current = v
          connectSyncedViewers()
        }} />
        <div
          className="curtain-pane-label curtain-pane-label-right"
          style={{ left: `calc(${position}% + 12px)`, right: 'auto', top: '16px', bottom: 'auto', display: position <= 74 ? undefined : 'none' }}
        >{rightLabel}</div>
      </div>

      {/* Drag handle */}
      <div
        className="curtain-handle"
        style={{ left: `${position}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Drag to compare"
        role="slider"
        aria-valuenow={Math.round(position)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="curtain-handle-line" />
        <div className="curtain-handle-knob">
          <span className="curtain-arrow">◀</span>
          <span className="curtain-arrow">▶</span>
        </div>
      </div>
    </div>
  )
}

type FocusQuadViewerProps = {
  sources: ViewerTileSource[]
  labels: string[]
  fallbackUrl: string
  position: NormalizedImagePoint
  onPositionChange: (position: NormalizedImagePoint) => void
  onViewerReady: (index: number, viewer: OpenSeadragon.Viewer) => void
  initialImageView?: NormalizedImageView | null
}

function FocusQuadViewer({ sources, labels, fallbackUrl, position, onPositionChange, onViewerReady, initialImageView }: FocusQuadViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const currentPositionRef = useRef(position)
  const onPositionChangeRef = useRef(onPositionChange)
  const layersRef = useRef<(HTMLDivElement | null)[]>([])
  const labelsRef = useRef<(HTMLDivElement | null)[]>([])
  const guidesRef = useRef<HTMLDivElement | null>(null)
  const applyPositionRef = useRef<(point: NormalizedImagePoint) => void>(() => {})
  const activeTouchPointersRef = useRef(new Set<number>())
  onPositionChangeRef.current = onPositionChange

  applyPositionRef.current = (point) => {
    currentPositionRef.current = point
    const x = point.x * 100
    const y = point.y * 100
    const clips = [
      `polygon(0 0, ${x}% 0, ${x}% ${y}%, 0 ${y}%)`,
      `polygon(${x}% 0, 100% 0, 100% ${y}%, ${x}% ${y}%)`,
      `polygon(0 ${y}%, ${x}% ${y}%, ${x}% 100%, 0 100%)`,
      `polygon(${x}% ${y}%, 100% ${y}%, 100% 100%, ${x}% 100%)`,
    ]
    layersRef.current.forEach((layer, index) => { if (layer) layer.style.clipPath = clips[index] })
    const labelPositions = [
      { left: `calc(${x}% - 10px)`, top: `calc(${y}% - 10px)`, transform: 'translate(-100%, -100%)' },
      { left: `calc(${x}% + 10px)`, top: `calc(${y}% - 10px)`, transform: 'translate(0, -100%)' },
      { left: `calc(${x}% - 10px)`, top: `calc(${y}% + 10px)`, transform: 'translate(-100%, 0)' },
      { left: `calc(${x}% + 10px)`, top: `calc(${y}% + 10px)`, transform: 'translate(0, 0)' },
    ]
    labelsRef.current.forEach((label, index) => {
      if (!label) return
      Object.assign(label.style, labelPositions[index])
      const width = index % 2 === 0 ? point.x : 1 - point.x
      const height = index < 2 ? point.y : 1 - point.y
      label.style.display = width >= 0.22 && height >= 0.16 ? '' : 'none'
    })
    guidesRef.current?.style.setProperty('--focus-x', `${x}%`)
    guidesRef.current?.style.setProperty('--focus-y', `${y}%`)
  }

  useEffect(() => {
    applyPositionRef.current(position)
  }, [position.x, position.y])

  useEffect(() => {
    const updatePositionFromPointer = (event: PointerEvent) => {
      const container = containerRef.current
      if (!container || !event.composedPath().includes(container)) return
      if (event.pointerType === 'touch' && activeTouchPointersRef.current.size > 1) return
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const next = {
        x: Math.min(0.95, Math.max(0.05, (event.clientX - rect.left) / rect.width)),
        y: Math.min(0.95, Math.max(0.05, (event.clientY - rect.top) / rect.height)),
      }
      applyPositionRef.current(next)
      onPositionChangeRef.current(next)
    }
    const trackTouchStart = (event: PointerEvent) => {
      const container = containerRef.current
      if (event.pointerType === 'touch' && container && event.composedPath().includes(container)) {
        activeTouchPointersRef.current.add(event.pointerId)
        updatePositionFromPointer(event)
      }
    }
    const trackTouchEnd = (event: PointerEvent) => { activeTouchPointersRef.current.delete(event.pointerId) }
    window.addEventListener('pointermove', updatePositionFromPointer, { capture: true, passive: true })
    window.addEventListener('pointerdown', trackTouchStart, { capture: true, passive: true })
    window.addEventListener('pointerup', trackTouchEnd, true)
    window.addEventListener('pointercancel', trackTouchEnd, true)
    return () => {
      window.removeEventListener('pointermove', updatePositionFromPointer, true)
      window.removeEventListener('pointerdown', trackTouchStart, true)
      window.removeEventListener('pointerup', trackTouchEnd, true)
      window.removeEventListener('pointercancel', trackTouchEnd, true)
      activeTouchPointersRef.current.clear()
    }
  }, [])

  const x = position.x * 100
  const y = position.y * 100
  const clips = [
    `polygon(0 0, ${x}% 0, ${x}% ${y}%, 0 ${y}%)`,
    `polygon(${x}% 0, 100% 0, 100% ${y}%, ${x}% ${y}%)`,
    `polygon(0 ${y}%, ${x}% ${y}%, ${x}% 100%, 0 100%)`,
    `polygon(${x}% ${y}%, 100% ${y}%, 100% 100%, ${x}% 100%)`,
  ]
  const labelPositions: React.CSSProperties[] = [
    { left: `calc(${x}% - 10px)`, top: `calc(${y}% - 10px)`, transform: 'translate(-100%, -100%)' },
    { left: `calc(${x}% + 10px)`, top: `calc(${y}% - 10px)`, transform: 'translate(0, -100%)' },
    { left: `calc(${x}% - 10px)`, top: `calc(${y}% + 10px)`, transform: 'translate(-100%, 0)' },
    { left: `calc(${x}% + 10px)`, top: `calc(${y}% + 10px)`, transform: 'translate(0, 0)' },
  ]
  const labelVisible = (index: number) => (index % 2 === 0 ? position.x : 1 - position.x) >= 0.22
    && (index < 2 ? position.y : 1 - position.y) >= 0.16

  return (
    <div ref={containerRef} className="focus-quad-container" aria-label="Focus Quad comparison">
      {sources.map((source, index) => (
        <div ref={(element) => { layersRef.current[index] = element }} key={`focus-pane-${index}`} className="focus-quad-layer" style={{ clipPath: clips[index], zIndex: index + 1 }}>
          <OpenSeadragonViewer
            tileSource={source}
            fallbackUrl={fallbackUrl}
            label={labels[index]}
            initialImageView={initialImageView}
            allowPan={false}
            onViewerReady={(viewer) => onViewerReady(index, viewer)}
          />
          <div
            ref={(element) => { labelsRef.current[index] = element }}
            className="focus-quad-pane-label"
            style={{ ...labelPositions[index], display: labelVisible(index) ? undefined : 'none' }}
          >{labels[index]}</div>
        </div>
      ))}
      <div ref={guidesRef} className="focus-quad-guides" aria-hidden="true" style={{ '--focus-x': `${x}%`, '--focus-y': `${y}%` } as React.CSSProperties}>
        <span className="focus-quad-guide-x" />
        <span className="focus-quad-guide-y" />
        <span className="focus-quad-guide-point" />
      </div>
    </div>
  )
}

// ── Band Viewer — blends adjacent decoded bands on a canvas ────────────────
type BandZoomController = {
  zoomBy: (factor: number) => void
  reset: () => void
}

type BandViewerProps = {
  bandImages: BandImage[]
  wavelength: number
  zoomControllerRef: React.MutableRefObject<BandZoomController | null>
}

function BandViewer({ bandImages, wavelength, zoomControllerRef }: BandViewerProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imagesRef = useRef<(HTMLImageElement | null)[]>([])
  const wavelengthRef = useRef(wavelength)
  const hasFrameRef = useRef(false)
  const zoomRef = useRef({ scale: 1, x: 0, y: 0 })
  const activePointersRef = useRef(new Map<number, NormalizedImagePoint>())
  const gestureRef = useRef<{ scale: number; x: number; y: number; distance: number; midpoint: NormalizedImagePoint; startPointer: NormalizedImagePoint } | null>(null)
  wavelengthRef.current = wavelength

  const applyZoom = (scale: number, x: number, y: number) => {
    const surface = surfaceRef.current
    if (!surface) return
    const nextScale = Math.min(20, Math.max(1, scale))
    const maxX = surface.clientWidth * (nextScale - 1) / 2
    const maxY = surface.clientHeight * (nextScale - 1) / 2
    const next = {
      scale: nextScale,
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    }
    zoomRef.current = next
    const canvas = canvasRef.current
    if (canvas) {
      canvas.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`
      surface.style.cursor = next.scale > 1 ? 'grab' : 'default'
    }
  }

  const zoomAt = (factor: number, focus?: NormalizedImagePoint) => {
    const surface = surfaceRef.current
    if (!surface) return
    const current = zoomRef.current
    const nextScale = Math.min(20, Math.max(1, current.scale * factor))
    const rect = surface.getBoundingClientRect()
    const focusX = focus?.x ?? rect.width / 2
    const focusY = focus?.y ?? rect.height / 2
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const ratio = nextScale / current.scale
    const nextX = focusX - centerX - (focusX - centerX - current.x) * ratio
    const nextY = focusY - centerY - (focusY - centerY - current.y) * ratio
    applyZoom(nextScale, nextX, nextY)
  }

  useEffect(() => {
    const controller: BandZoomController = {
      zoomBy: (factor) => zoomAt(factor),
      reset: () => applyZoom(1, 0, 0),
    }
    zoomControllerRef.current = controller
    return () => {
      if (zoomControllerRef.current === controller) zoomControllerRef.current = null
    }
  }, [])

  const onBandWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    zoomAt(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  const onBandPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const points = [...activePointersRef.current.values()]
    const current = zoomRef.current
    const rect = event.currentTarget.getBoundingClientRect()
    const midpoint = points.length > 1
      ? { x: (points[0].x + points[1].x) / 2 - rect.left, y: (points[0].y + points[1].y) / 2 - rect.top }
      : { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const distance = points.length > 1
      ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      : 0
    gestureRef.current = {
      ...current,
      distance,
      midpoint,
      startPointer: { x: event.clientX, y: event.clientY },
    }
  }

  const onBandPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) return
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const points = [...activePointersRef.current.values()]
    const gesture = gestureRef.current
    const rect = event.currentTarget.getBoundingClientRect()
    if (!gesture) return
    if (points.length > 1 && gesture.distance > 0) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      const midpoint = { x: (points[0].x + points[1].x) / 2 - rect.left, y: (points[0].y + points[1].y) / 2 - rect.top }
      const ratio = distance / gesture.distance
      const scale = Math.min(20, Math.max(1, gesture.scale * ratio))
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const nextX = midpoint.x - centerX - (gesture.midpoint.x - centerX - gesture.x) * (scale / gesture.scale)
      const nextY = midpoint.y - centerY - (gesture.midpoint.y - centerY - gesture.y) * (scale / gesture.scale)
      applyZoom(scale, nextX, nextY)
      return
    }
    if (points.length === 1 && gesture.scale > 1) {
      applyZoom(gesture.scale, gesture.x + event.clientX - gesture.startPointer.x, gesture.y + event.clientY - gesture.startPointer.y)
    }
  }

  const onBandPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId)
    const points = [...activePointersRef.current.values()]
    if (points.length === 1) {
      const current = zoomRef.current
      const [point] = points
      gestureRef.current = {
        ...current,
        distance: 0,
        midpoint: { x: 0, y: 0 },
        startPointer: { x: point.x, y: point.y },
      }
    } else if (points.length === 0) {
      gestureRef.current = null
    }
  }

  const onBandDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    zoomAt(2, { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  const drawRef = useRef<() => void>(() => {})
  drawRef.current = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !context || bandImages.length === 0) return

    const sorted = bandImages
      .map((item, index) => ({
        index,
        value: item.wavelength ?? item.bandIndex,
        image: imagesRef.current[index],
      }))
      .sort((a, b) => a.value - b.value)
    const value = wavelengthRef.current
    let lower = sorted[0]
    let upper = sorted[sorted.length - 1]

    if (value <= lower.value) upper = lower
    else if (value >= upper.value) lower = upper
    else {
      for (let i = 0; i < sorted.length - 1; i += 1) {
        if (value >= sorted[i].value && value <= sorted[i + 1].value) {
          lower = sorted[i]
          upper = sorted[i + 1]
          break
        }
      }
    }

    const lowerImage = lower.image
    const upperImage = upper.image
    const lowerReady = Boolean(lowerImage?.complete && lowerImage.naturalWidth > 0)
    const upperReady = Boolean(upperImage?.complete && upperImage.naturalWidth > 0)
    // Leave the last painted frame in place while either requested band loads.
    if (!lowerReady && !upperReady) return
    if (lower !== upper && (!lowerReady || !upperReady) && hasFrameRef.current) return

    const firstImage = lowerReady ? lowerImage! : upperImage!
    if (canvas.width !== firstImage.naturalWidth || canvas.height !== firstImage.naturalHeight) {
      canvas.width = firstImage.naturalWidth
      canvas.height = firstImage.naturalHeight
    }

    const fraction = lower === upper || upper.value === lower.value
      ? 0
      : Math.max(0, Math.min(1, (value - lower.value) / (upper.value - lower.value)))
    context.globalAlpha = 1
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(lowerReady ? lowerImage! : upperImage!, 0, 0, canvas.width, canvas.height)
    if (lower !== upper && lowerReady && upperReady) {
      context.globalAlpha = fraction
      context.drawImage(upperImage!, 0, 0, canvas.width, canvas.height)
      context.globalAlpha = 1
    }
    hasFrameRef.current = true
  }

  useEffect(() => {
    let cancelled = false
    hasFrameRef.current = false
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    const images = bandImages.map((item, index) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        if (!cancelled) drawRef.current()
      }
      image.src = resolveBackendAssetUrl(item.imageUrl)
      imagesRef.current[index] = image
      // Decode in the background so drawing during a drag does not block on it.
      if (typeof image.decode === 'function') {
        image.decode().then(() => {
          if (!cancelled) drawRef.current()
        }).catch(() => undefined)
      }
      return image
    })
    imagesRef.current = images
    drawRef.current()

    return () => {
      cancelled = true
      images.forEach((image) => { image.onload = null })
      imagesRef.current = []
    }
  }, [bandImages])

  useEffect(() => {
    let frame = 0
    frame = window.requestAnimationFrame(() => drawRef.current())
    return () => window.cancelAnimationFrame(frame)
  }, [wavelength])

  return (
    <div
      ref={surfaceRef}
      className="band-viewer-surface"
      onWheel={onBandWheel}
      onPointerDown={onBandPointerDown}
      onPointerMove={onBandPointerMove}
      onPointerUp={onBandPointerEnd}
      onPointerCancel={onBandPointerEnd}
      onDoubleClick={onBandDoubleClick}
    >
      <canvas
        ref={canvasRef}
        aria-label={`Spectral band at ${wavelength} nanometers`}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', transformOrigin: 'center', willChange: 'transform' }}
      />
    </div>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('standby')
  const [initialSharedView] = useState(() => parseSharedViewerState(window.location.search))
  const [artworks, setArtworks] = useState<Artwork[]>([])
  const [collectionPage, setCollectionPage] = useState(0)
  const [selectedArtworkId, setSelectedArtworkId] = useState<string>(initialSharedView?.artworkId ?? '')
  const [selectedVisualization, setSelectedVisualization] = useState<VisualizationId>(initialSharedView?.selectedVisualization ?? 'rgb')
  const [compareMode, setCompareMode] = useState<CompareMode>(initialSharedView?.compareMode ?? 'single')
  const [curtainLeftViz, setCurtainLeftViz] = useState<CompareSourceId>(initialSharedView?.curtainLeftViz ?? 'rgb')
  const [curtainRightViz, setCurtainRightViz] = useState<CompareSourceId>(initialSharedView?.curtainRightViz ?? 'falseColor')
  const [splitLeftViz, setSplitLeftViz] = useState<CompareSourceId>(initialSharedView?.splitLeftViz ?? 'rgb')
  const [splitRightViz, setSplitRightViz] = useState<CompareSourceId>(initialSharedView?.splitRightViz ?? 'falseColor')
  const [overlayViz, setOverlayViz] = useState<CompareSourceId>(initialSharedView?.overlayViz ?? 'infrared')
  const [overlayBaseViz, setOverlayBaseViz] = useState<CompareSourceId>(initialSharedView?.overlayBaseViz ?? 'rgb')
  const [quadVizIds, setQuadVizIds] = useState<CompareSourceId[]>(initialSharedView?.quadVizIds ?? ['rgb', 'infrared', 'falseColor', 'xray'])
  const [comparisonBandIndices, setComparisonBandIndices] = useState<number[]>(initialSharedView?.comparisonBandIndices ?? [0, 0, 0, 0])
  const [activeBandPane, setActiveBandPane] = useState(initialSharedView?.activeBandPane ?? 0)
  const [linkBands, setLinkBands] = useState(initialSharedView?.linkBands ?? false)
  const [overlayOpacity, setOverlayOpacity] = useState(initialSharedView?.overlayOpacity ?? 0.5)
  const [curtainPosition, setCurtainPosition] = useState(initialSharedView?.curtainPosition ?? 50)
  const focusQuadPositionRef = useRef<NormalizedImagePoint>(initialSharedView?.focusQuadPosition ?? { x: 0.5, y: 0.5 })
  const [linkedPointer, setLinkedPointer] = useState(initialSharedView?.linkedPointer ?? false)
  const [showCompareLabels, setShowCompareLabels] = useState(initialSharedView?.showCompareLabels ?? true)
  const [pointerPosition, setPointerPosition] = useState<NormalizedImagePoint | null>(initialSharedView?.pointerPosition ?? null)
  const pendingPointerPositionRef = useRef<NormalizedImagePoint | null>(null)
  const pointerUpdateTimerRef = useRef<number | null>(null)
  const [restoreImageView, setRestoreImageView] = useState<NormalizedImageView | null>(initialSharedView?.imageView ?? null)
  const [shareFeedback, setShareFeedback] = useState('')
  const shareRestoreAttemptedRef = useRef(false)
  const splitLeftRef = useRef<OpenSeadragon.Viewer | null>(null)
  const splitRightRef = useRef<OpenSeadragon.Viewer | null>(null)
  const splitSyncGuard = useRef(false)
  const overlayBaseRef = useRef<OpenSeadragon.Viewer | null>(null)
  const overlayTopRef = useRef<OpenSeadragon.Viewer | null>(null)
  const overlaySyncGuard = useRef(false)
  const quadRefs = useRef<(OpenSeadragon.Viewer | null)[]>([null, null, null, null])
  const quadSyncGuard = useRef(false)
  // Store active sync cleanup functions so mode changes and toggles can unwire them.
  const primaryViewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const syncCleanupsRef = useRef<(() => void)[]>([])
  const addSyncCleanup = (fn: () => void) => syncCleanupsRef.current.push(fn)
  const clearSyncCleanups = () => {
    syncCleanupsRef.current.forEach((fn) => fn())
    syncCleanupsRef.current = []
  }
  const [band, setBand] = useState(730)
  const [isBandModeActive, setIsBandModeActive] = useState(false)
  const bandZoomControllerRef = useRef<BandZoomController | null>(null)
  const [bandControlPlacement, setBandControlPlacement] = useState<BandControlPlacement>('overlay')
  const [bandPanelOpacity, setBandPanelOpacity] = useState(4)
  const [syncZoom, setSyncZoom] = useState(initialSharedView?.syncZoom ?? true)
  // Returns all currently mounted OSD viewers depending on active mode
  const getAllActiveViewers = (): OpenSeadragon.Viewer[] => {
    if (compareMode === 'split') return [splitLeftRef.current, splitRightRef.current].filter(Boolean) as OpenSeadragon.Viewer[]
    if (compareMode === 'overlay') return [overlayBaseRef.current, overlayTopRef.current].filter(Boolean) as OpenSeadragon.Viewer[]
    if (compareMode === 'quad' || compareMode === 'focusQuad') return quadRefs.current.filter(Boolean) as OpenSeadragon.Viewer[]
    if (compareMode === 'curtain') return [primaryViewerRef.current].filter(Boolean) as OpenSeadragon.Viewer[]
    return [primaryViewerRef.current].filter(Boolean) as OpenSeadragon.Viewer[]
  }

  const resetViewerRefs = () => {
    splitLeftRef.current = null
    splitRightRef.current = null
    overlayBaseRef.current = null
    overlayTopRef.current = null
    quadRefs.current = [null, null, null, null]
    clearSyncCleanups()
  }
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(false)
  const [activeToolPanel, setActiveToolPanel] = useState<ToolPanel>('artwork')

  const inactivityTimerRef = useRef<number | null>(null)

  const refreshDatasets = () => {
    fetch(backendDatasetsUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load backend datasets: ${response.status}`)
        }
        return response.json()
      })
      .then((data: { items?: BackendDataset[] }) => {
        const items: Artwork[] = (data.items ?? [])
          .map((item): Artwork | null => {
            const resolvedHero = resolveBackendAssetUrl(item.hero || item.thumbnail || '')
            const resolvedThumbnail = resolveBackendAssetUrl(item.thumbnail || item.hero || '')

            if (!resolvedHero || !resolvedThumbnail) {
              return null
            }

            const availableVisualizationIds = (item.availableVisualizations ?? []).filter(
              (vizId): vizId is VisualizationId => vizId in visualizationDefinitions,
            )

            return {
              id: item.id,
              title: item.title || item.id || 'Untitled artwork',
              artist: item.artist || 'Unknown artist',
              year: item.year || 'Unknown date',
              collection: item.collection || 'Uploaded datasets',
              thumbnail: resolvedThumbnail,
              hero: resolvedHero,
              visualizations: Array.from(
                new Set<VisualizationId>(['rgb', ...availableVisualizationIds]),
              ).map((vizId) => visualizationDefinitions[vizId]),
              visualizationAssets: Object.fromEntries(
                Array.from(new Set<VisualizationId>(['rgb', ...availableVisualizationIds])).map(
                  (vizId) => [
                    vizId,
                    {
                      id: vizId,
                      label: visualizationDefinitions[vizId].label,
                      tone: visualizationDefinitions[vizId].tone,
                      description: visualizationDefinitions[vizId].description,
                      available: true,
                      sourceType: 'image',
                      tileSource: null,
                      imageUrl: vizId === 'rgb' ? resolvedHero : null,
                    },
                  ],
                ),
              ) as Partial<Record<VisualizationId, VisualizationAsset>>,
              bandImages: [],
            }
          })
          .filter((item): item is Artwork => item !== null)

        setArtworks(items)
        if (items.length > 0) {
          setSelectedArtworkId((current) =>
            current && items.some((item) => item.id === current) ? current : items[0].id,
          )
        } else {
          setSelectedArtworkId('')
        }
      })
      .catch((error) => {
        console.error('Failed to load backend datasets', error)
        setArtworks([])
        setSelectedArtworkId('')
      })
  }



  useEffect(() => {
    refreshDatasets()
  }, [])

  const selectedArtwork = useMemo(
    () => artworks.find((artwork) => artwork.id === selectedArtworkId) ?? artworks[0],
    [artworks, selectedArtworkId],
  )

  const sortedBandImages = useMemo(
    () => [...(selectedArtwork?.bandImages ?? [])].sort((a, b) => (a.wavelength ?? a.bandIndex) - (b.wavelength ?? b.bandIndex)),
    [selectedArtwork],
  )

  const compareSources: CompareSourceId[] = compareMode === 'curtain'
    ? [curtainLeftViz, curtainRightViz]
    : compareMode === 'split'
      ? [splitLeftViz, splitRightViz]
      : compareMode === 'quad' || compareMode === 'focusQuad'
        ? quadVizIds
        : compareMode === 'overlay'
          ? [overlayBaseViz, overlayViz]
          : []
  const bandSourcePanes = compareSources
    .map((source, pane) => source === 'band' ? pane : -1)
    .filter((pane) => pane >= 0)
  const selectedCompareBandPane = bandSourcePanes.includes(activeBandPane) ? activeBandPane : bandSourcePanes[0]

  const getCompareBand = (pane: number) => sortedBandImages[comparisonBandIndices[pane] ?? 0]
  const getCompareSourceLabel = (source: CompareSourceId, pane: number) => {
    if (source === 'band') {
      const item = getCompareBand(pane)
      return item ? `Band ${item.bandIndex + 1} · ${item.wavelength ?? item.bandIndex} nm` : 'Single band'
    }
    return visualizationDefinitions[source]?.label ?? source
  }
  const getCompareTileSource = (source: CompareSourceId, pane: number): ViewerTileSource => {
    if (source === 'band') {
      const item = getCompareBand(pane)
      return item
        ? { type: 'image', url: item.imageUrl } as unknown as ViewerTileSource
        : toOsdTileSource(selectedArtwork?.visualizationAssets?.rgb, selectedArtwork?.hero ?? '')
    }
    return toOsdTileSource(selectedArtwork?.visualizationAssets?.[source] ?? selectedArtwork?.visualizationAssets?.rgb, selectedArtwork?.hero ?? '')
  }

  const selectedBandInfo = useMemo(() => {
    const items = selectedArtwork?.bandImages ?? []
    if (!items.length) return null
    return items.reduce((nearest, item) => {
      const distance = Math.abs((item.wavelength ?? item.bandIndex) - band)
      const nearestDistance = Math.abs((nearest.wavelength ?? nearest.bandIndex) - band)
      return distance < nearestDistance ? item : nearest
    }, items[0])
  }, [selectedArtwork, band])

  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      window.clearTimeout(inactivityTimerRef.current)
    }

    if (screen === 'standby') return

    inactivityTimerRef.current = window.setTimeout(() => {
      setIsControlPanelOpen(false)
      setActiveToolPanel('artwork')
      setCompareMode('single')
      setSelectedVisualization('rgb')
      setScreen('standby')
    }, inactivityTimeoutMs)
  }

  useEffect(() => {
    resetInactivityTimer()

    const events: (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'touchstart']
    const handleActivity = () => {
      resetInactivityTimer()
    }

    events.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }))

    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity))
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current)
      }
    }
  }, [screen])

  const availableVisualizations = useMemo(() => {
    if (!selectedArtwork) return []

    const configuredVisualizations = selectedArtwork.visualizations ?? []

    if (configuredVisualizations.length > 0) {
      return configuredVisualizations.map((item) => {
        const asset = selectedArtwork.visualizationAssets?.[item.id]
        return {
          ...item,
          available: asset ? Boolean(asset.available) : item.id === 'rgb',
        }
      })
    }

    return (Object.values(visualizationDefinitions) as Visualization[]).map((item) => {
      const asset = selectedArtwork.visualizationAssets?.[item.id]
      return {
        ...item,
        available: asset ? Boolean(asset.available) : item.id === 'rgb',
      }
    })
  }, [selectedArtwork])

  const currentVisualization =
    availableVisualizations.find((item) => item.id === selectedVisualization) ??
    availableVisualizations.find((item) => item.available) ??
    availableVisualizations[0]

  const renderCompareSourceSelect = (
    label: string,
    value: CompareSourceId,
    pane: number,
    onChange: (value: CompareSourceId) => void,
  ) => (
    <label className="compare-source-select-label">
      <span>{label}</span>
      <select className="compare-source-select" value={value} onChange={(event) => {
        const next = event.target.value as CompareSourceId
        onChange(next)
        if (next === 'band') setActiveBandPane(pane)
      }}>
        {availableVisualizations.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.available ? item.label : `${item.label} unavailable`}</option>)}
        <option value="band" disabled={!sortedBandImages.length}>Single band{sortedBandImages.length ? '' : ' unavailable'}</option>
      </select>
    </label>
  )

  const activeVisualizationId = currentVisualization?.id ?? 'rgb'
  const activeVisualizationAsset = selectedArtwork?.visualizationAssets?.[activeVisualizationId]

  // Reactively wire/unwire sync when checkbox toggles or mode changes
  useEffect(() => {
    clearSyncCleanups()
    if (!syncZoom && compareMode !== 'focusQuad') return
    if (compareMode === 'split') {
      wireSyncWhenReady(splitLeftRef, splitRightRef, splitSyncGuard, addSyncCleanup)
    }
    if (compareMode === 'overlay') {
      wireSyncWhenReady(overlayBaseRef, overlayTopRef, overlaySyncGuard, addSyncCleanup)
    }
    if (compareMode === 'quad' || compareMode === 'focusQuad') {
      let cancelled = false
      const attempt = (tries = 0) => {
        if (cancelled) return
        const viewers = quadRefs.current
        if (viewers.every((viewer): viewer is OpenSeadragon.Viewer => Boolean(viewer))) {
          for (let a = 0; a < viewers.length; a += 1) {
            for (let b = a + 1; b < viewers.length; b += 1) {
              const left = viewers[a]
              const right = viewers[b]
              if (!left || !right) continue
              addSyncCleanup(syncOsdViewers(left, right, quadSyncGuard))
              addSyncCleanup(syncOsdViewers(right, left, quadSyncGuard))
            }
          }
        } else if (tries < 30) {
          window.setTimeout(() => attempt(tries + 1), 100)
        }
      }
      attempt()
      return () => {
        cancelled = true
        clearSyncCleanups()
      }
    }
    return () => clearSyncCleanups()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncZoom, compareMode])

  // activeTileSource only feeds the OSD viewer (visualizations, not bands)
  // Band mode uses a separate pure-CSS image stack (BandViewer) for flicker-free sliding
  const activeTileSource = toOsdTileSource(
    activeVisualizationAsset,
    selectedArtwork?.hero ?? '',
  )
  const linkedPointerVisible = compareMode !== 'single' && linkedPointer

  useEffect(() => {
    const items = selectedArtwork?.bandImages ?? []

    if (!items.length) {
      setIsBandModeActive(false)
      return
    }

    const defaultBand =
      items[Math.floor(items.length / 2)]?.wavelength ??
      items[0]?.wavelength ??
      items[0]?.bandIndex ??
      730

    setBand(Number(defaultBand))
  }, [selectedArtworkId, selectedArtwork])

  // Keep the current image region when the tool panel changes the viewer size.
  useEffect(() => {
    if (isBandModeActive) return
    const timer = window.setTimeout(() => {
      getAllActiveViewers().forEach((viewer) => {
        try {
          viewer.viewport?.applyConstraints(true)
          viewer.forceRedraw()
        } catch {
          // A viewer may be in the middle of being replaced during a mode change.
        }
      })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [isControlPanelOpen, activeToolPanel, bandControlPlacement, isBandModeActive, compareMode])


  useEffect(() => {
    if (!currentVisualization?.available) {
      const fallbackVisualization = availableVisualizations.find((item) => item.available)

      if (fallbackVisualization && fallbackVisualization.id !== selectedVisualization) {
        setSelectedVisualization(fallbackVisualization.id)
      }
    }
  }, [availableVisualizations, currentVisualization, selectedVisualization])

  const openArtwork = async (artworkId: string, sharedState?: SharedViewerState) => {
    const artwork = artworks.find((item) => item.id === artworkId)

    setSelectedArtworkId(artworkId)
    setSelectedVisualization(sharedState?.selectedVisualization ?? 'rgb')
    setCompareMode(sharedState?.compareMode ?? 'single')
    setCurtainLeftViz(sharedState?.curtainLeftViz ?? 'rgb')
    setCurtainRightViz(sharedState?.curtainRightViz ?? 'falseColor')
    setSplitLeftViz(sharedState?.splitLeftViz ?? 'rgb')
    setSplitRightViz(sharedState?.splitRightViz ?? 'falseColor')
    setOverlayViz(sharedState?.overlayViz ?? 'infrared')
    setOverlayBaseViz(sharedState?.overlayBaseViz ?? 'rgb')
    setQuadVizIds(sharedState?.quadVizIds ?? ['rgb', 'infrared', 'falseColor', 'xray'])
    setComparisonBandIndices(sharedState?.comparisonBandIndices ?? [0, 0, 0, 0])
    setActiveBandPane(sharedState?.activeBandPane ?? 0)
    setLinkBands(sharedState?.linkBands ?? false)
    setOverlayOpacity(sharedState?.overlayOpacity ?? 0.5)
    setSyncZoom(sharedState?.syncZoom ?? true)
    setLinkedPointer(sharedState?.linkedPointer ?? false)
    setShowCompareLabels(sharedState?.showCompareLabels ?? true)
    setPointerPosition(sharedState?.pointerPosition ?? null)
    setCurtainPosition(sharedState?.curtainPosition ?? 50)
    focusQuadPositionRef.current = sharedState?.focusQuadPosition ?? { x: 0.5, y: 0.5 }
    setRestoreImageView(sharedState?.imageView ?? null)
    setActiveToolPanel(sharedState && sharedState.compareMode !== 'single' ? 'compare' : 'artwork')
    setIsControlPanelOpen(false)
    setIsBandModeActive(false)
    if (!sharedState) {
      const url = new URL(window.location.href)
      url.searchParams.delete('view')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }

    try {
      const response = await fetch(backendDatasetDetailUrl(artworkId))
      if (!response.ok) {
        throw new Error(`Failed to load dataset detail: ${response.status}`)
      }

      const detail = (await response.json()) as BackendDatasetDetail

      // Merge backend iiifSources into visualizationAssets so each viz gets its tileSource
      const visualizationAssets = Object.fromEntries(
        (detail.visualizations ?? []).map((viz) => [
          viz.id,
          {
            ...viz,
            sourceType: viz.sourceType ?? 'image',
            tileSource: viz.tileSource
              ? resolveBackendAssetUrl(viz.tileSource)
              : null,
            imageUrl: viz.imageUrl
              ? resolveBackendAssetUrl(viz.imageUrl)
              : null,
          },
        ]),
      ) as Partial<Record<VisualizationId, VisualizationAsset>>


      const nextArtwork: Artwork = {
        id: detail.id,
        title: detail.title,
        artist: detail.artist ?? artwork?.artist ?? 'Unknown',
        year: detail.year ?? artwork?.year ?? 'Unknown',
        collection: detail.collection ?? artwork?.collection ?? 'Uploaded datasets',
        thumbnail: resolveBackendAssetUrl(detail.thumbnail || artwork?.thumbnail || ''),
        hero: resolveBackendAssetUrl(detail.hero || artwork?.hero || ''),
        iiifSources: {
          rgb:
            visualizationAssets.rgb?.tileSource
              ? visualizationAssets.rgb.tileSource
              : visualizationAssets.rgb?.imageUrl
                ? { type: 'image', url: visualizationAssets.rgb.imageUrl }
                : artwork?.hero
                  ? { type: 'image', url: artwork.hero }
                  : undefined,
          falseColor:
            visualizationAssets.falseColor?.imageUrl
              ? { type: 'image', url: visualizationAssets.falseColor.imageUrl }
              : undefined,
        },
        visualizations: [
          ...(detail.visualizations ?? [])
            .filter((viz) => viz.id in visualizationDefinitions)
            .map((viz) => ({
              id: viz.id as VisualizationId,
              label: viz.label,
              tone: viz.tone,
              description: viz.description,
            })),
        ],
        visualizationAssets,
        bandImages: (detail.bands?.items ?? []).map((item) => ({
          bandIndex: item.bandIndex,
          wavelength: item.wavelength ?? null,
          imageUrl: resolveBackendAssetUrl(item.imageUrl),
        })),
      }

      setArtworks((current) =>
        current.map((item) => (item.id === artworkId ? nextArtwork : item)),
      )

      if (visualizationAssets.rgb?.available) {
        setSelectedVisualization('rgb')
      }

      setScreen('viewer')
    } catch (error) {
      console.error('Failed to load dataset detail for viewer', error)
      setScreen('viewer')
    }
  }

  const openCollection = () => {
    setIsControlPanelOpen(false)
    setScreen('collection')
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  useEffect(() => {
    if (!initialSharedView || !artworks.length || shareRestoreAttemptedRef.current) return
    if (!artworks.some((item) => item.id === initialSharedView.artworkId)) return
    shareRestoreAttemptedRef.current = true
    void openArtwork(initialSharedView.artworkId, initialSharedView)
  }, [artworks, initialSharedView])

  const shareCurrentView = async () => {
    if (!selectedArtwork) return
    const snapshot: SharedViewerState = {
      artworkId: selectedArtwork.id,
      selectedVisualization,
      compareMode,
      curtainLeftViz,
      curtainRightViz,
      splitLeftViz,
      splitRightViz,
      overlayViz,
      overlayBaseViz,
      quadVizIds,
      comparisonBandIndices,
      activeBandPane,
      linkBands,
      overlayOpacity,
      syncZoom: syncZoom || compareMode === 'focusQuad',
      linkedPointer: compareMode !== 'single' && compareMode !== 'focusQuad' && linkedPointer,
      showCompareLabels,
      pointerPosition: pendingPointerPositionRef.current ?? pointerPosition,
      curtainPosition,
      focusQuadPosition: focusQuadPositionRef.current,
      imageView: captureImageView(getAllActiveViewers()[0] ?? null),
    }
    const url = new URL(window.location.href)
    url.searchParams.set('view', JSON.stringify(snapshot))
    try {
      await navigator.clipboard.writeText(url.toString())
      setShareFeedback('Link copied')
    } catch {
      window.prompt('Copy this view link', url.toString())
      setShareFeedback('Copy the link to share this view')
    }
    window.setTimeout(() => setShareFeedback(''), 2600)
  }

  const getZoomTargets = () => {
    const viewers = getAllActiveViewers()
    return (syncZoom || compareMode === 'focusQuad') && compareMode !== 'single' ? viewers.slice(0, 1) : viewers
  }

  const zoomActiveViewers = (factor: number) => {
    if (compareMode === 'single' && isBandModeActive) {
      bandZoomControllerRef.current?.zoomBy(factor)
      return
    }
    getZoomTargets().forEach((viewer) => {
      viewer.viewport?.zoomBy(factor, undefined, true)
      viewer.viewport?.applyConstraints(true)
    })
  }

  const fitActiveViewers = () => {
    if (compareMode === 'single' && isBandModeActive) {
      bandZoomControllerRef.current?.reset()
      return
    }
    getZoomTargets().forEach((viewer) => viewer.viewport?.goHome(true))
  }

  const consumeRestoredImageView = () => {
    if (restoreImageView) setRestoreImageView(null)
  }

  const queuePointerPosition = (position: NormalizedImagePoint) => {
    pendingPointerPositionRef.current = position
    if (pointerUpdateTimerRef.current !== null) return
    pointerUpdateTimerRef.current = window.setTimeout(() => {
      if (pendingPointerPositionRef.current) setPointerPosition(pendingPointerPositionRef.current)
      pointerUpdateTimerRef.current = null
    }, 30)
  }


  const goToStandby = () => {
    setIsControlPanelOpen(false)
    setActiveToolPanel('artwork')
    setCompareMode('single')
    setSelectedVisualization('rgb')
    setScreen('standby')
  }

  const openToolPanel = (panelId: ToolPanel) => {
    setActiveToolPanel(panelId)
    setIsControlPanelOpen(true)
  }

  if (artworks.length === 0 || !selectedArtwork) {
    return <div className="app-shell">Loading collection…</div>
  }

  return (
    <div className={`app-shell screen-${screen}`}>
      {screen === 'collection' && (
        <header className="topbar">
          <div className="topbar-copy">
            <h1>Explore the collection</h1>
          </div>

          <nav className="topbar-actions" aria-label="Primary navigation">
            <button className="nav-button" onClick={goToStandby}>
              Standby
            </button>
            <button className="nav-button active" onClick={openCollection}>
              Collection
            </button>
          </nav>
        </header>
      )}

      {screen === 'standby' && (
        <section
          className="standby-screen"
          onClick={openCollection}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              openCollection()
            }
          }}
        >
          <div className="standby-featured-panel">
            <img src={selectedArtwork.hero} alt={selectedArtwork.title} />
            <div className="standby-image-shade" />
          </div>

          <div className="standby-copy">
            <p className="eyebrow">Artwork Explorer</p>
            <h1>Touch anywhere to begin</h1>

            <div className="standby-meta">
              <span>{selectedArtwork.collection}</span>
              <strong>{selectedArtwork.title}</strong>
              <span>
                {selectedArtwork.artist} · {selectedArtwork.year}
              </span>
            </div>
          </div>
          <p className="system-credit standby-system-credit">
            Interactive viewer by{' '}
            <a
              href="https://www.ntnu.no/ansatte/dipendra.mandal"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              Dipendra Mandal
            </a>
            {' · '}
            <a
              href="https://github.com/djmandal"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              GitHub @djmandal
            </a>
          </p>
        </section>
      )}

      {screen === 'collection' && (
        <section className="collection-screen">
          <div className="section-heading">
            <p className="section-support">Tap an artwork to begin.</p>
          </div>

          {(() => {
            const PAGE_SIZE = window.innerWidth >= 1400 ? 6 : 4
            const totalPages = Math.ceil(artworks.length / PAGE_SIZE)
            const pageArtworks = artworks.slice(collectionPage * PAGE_SIZE, (collectionPage + 1) * PAGE_SIZE)
            return (
              <>
                <div className="artwork-grid">
                  {pageArtworks.map((artwork) => (
                    <button
                      key={artwork.id}
                      className="artwork-card"
                      onClick={() => openArtwork(artwork.id)}
                    >
                      <div className="artwork-card-image-wrap">
                        <img src={artwork.thumbnail} alt={artwork.title} />
                      </div>

                      <div className="artwork-card-copy">
                        <span>{artwork.collection || 'Uploaded datasets'}</span>
                        <strong>{artwork.title || 'Untitled artwork'}</strong>
                        <span>
                          {(artwork.artist || 'Unknown artist')} · {(artwork.year || 'Unknown date')}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="collection-pagination">
                    {collectionPage > 0 && (
                      <button
                        className="nav-button"
                        onClick={() => setCollectionPage((p) => p - 1)}
                      >
                        ← Previous
                      </button>
                    )}
                    <span className="pagination-label">
                      {collectionPage + 1} / {totalPages}
                    </span>
                    {collectionPage < totalPages - 1 && (
                      <button
                        className="nav-button"
                        onClick={() => setCollectionPage((p) => p + 1)}
                      >
                        Next →
                      </button>
                    )}
                  </div>
                )}
              </>
            )
          })()}
        </section>
      )}


      {screen === 'viewer' && (
        <section className={isControlPanelOpen ? 'viewer-screen tools-open' : 'viewer-screen'}>
          <div className={
            activeToolPanel === 'visualization' && isBandModeActive && bandControlPlacement === 'below'
              ? 'viewer-stage has-band-controls-below'
              : 'viewer-stage'
          }>
            <div className={`viewer-canvas tone-${currentVisualization?.tone ?? 'rgb'}${compareMode !== 'single' && !showCompareLabels ? ' hide-compare-labels' : ''}`}>
              <div className="viewer-overlay viewer-overlay-top">
                <button className="viewer-back-button" onClick={openCollection}>
                  Back to collection
                </button>

                <div className="viewer-artwork-chip">
                  <strong>{selectedArtwork.title}</strong>
                  <span>
                    {selectedArtwork.artist} · {selectedArtwork.year}
                  </span>
                </div>
              </div>
              {compareMode === 'curtain' ? (
                <CurtainViewer
                  onAnyViewerReady={(v) => {
                    primaryViewerRef.current = v
                    consumeRestoredImageView()
                  }}
                  leftSource={getCompareTileSource(curtainLeftViz, 0)}
                  rightSource={getCompareTileSource(curtainRightViz, 1)}
                  leftLabel={getCompareSourceLabel(curtainLeftViz, 0)}
                  rightLabel={getCompareSourceLabel(curtainRightViz, 1)}
                  fallbackUrl={selectedArtwork.hero}
                  syncZoom={syncZoom}
                  position={curtainPosition}
                  onPositionChange={setCurtainPosition}
                  linkedPointer={linkedPointerVisible}
                  pointerPosition={pointerPosition}
                  onPointerPositionChange={queuePointerPosition}
                  initialImageView={restoreImageView}
                />
              ) : compareMode === 'split' ? (
                <div className="split-view-grid">
                  <div className="split-view-pane">
                    <OpenSeadragonViewer
                      tileSource={getCompareTileSource(splitLeftViz, 0)}
                      label={getCompareSourceLabel(splitLeftViz, 0)}
                      fallbackUrl={selectedArtwork.hero}
                      linkedPointer={linkedPointerVisible}
                      pointerPosition={pointerPosition}
                      onPointerPositionChange={queuePointerPosition}
                      initialImageView={restoreImageView}
                      onViewerReady={(v) => {
                        splitLeftRef.current = v
                        consumeRestoredImageView()
                      }}
                    />
                    <div className="split-view-label split-view-label-left">{getCompareSourceLabel(splitLeftViz, 0)}</div>
                  </div>
                  <div className="split-view-pane">
                    <OpenSeadragonViewer
                      tileSource={getCompareTileSource(splitRightViz, 1)}
                      label={getCompareSourceLabel(splitRightViz, 1)}
                      fallbackUrl={selectedArtwork.hero}
                      linkedPointer={linkedPointerVisible}
                      pointerPosition={pointerPosition}
                      onPointerPositionChange={queuePointerPosition}
                      initialImageView={restoreImageView}
                      onViewerReady={(v) => {
                        splitRightRef.current = v
                        consumeRestoredImageView()
                      }}
                    />
                    <div className="split-view-label split-view-label-right">
                      {getCompareSourceLabel(splitRightViz, 1)}
                    </div>
                  </div>
                </div>
              ) : compareMode === 'focusQuad' ? (
                <FocusQuadViewer
                  sources={quadVizIds.map((source, pane) => getCompareTileSource(source, pane))}
                  labels={quadVizIds.map((source, pane) => getCompareSourceLabel(source, pane))}
                  fallbackUrl={selectedArtwork.hero}
                  position={focusQuadPositionRef.current}
                  onPositionChange={(position) => { focusQuadPositionRef.current = position }}
                  initialImageView={restoreImageView}
                  onViewerReady={(paneIdx, viewer) => {
                    quadRefs.current[paneIdx] = viewer
                    if (paneIdx === 0) consumeRestoredImageView()
                  }}
                />
              ) : compareMode === 'quad' ? (
                <div className="quad-view-grid">
                  {quadVizIds.map((source, paneIdx) => {
                    return (
                      <div key={`compare-pane-${paneIdx}`} className="quad-view-pane">
                        <OpenSeadragonViewer
                          tileSource={getCompareTileSource(source, paneIdx)}
                          label={getCompareSourceLabel(source, paneIdx)}
                          fallbackUrl={selectedArtwork.hero}
                          linkedPointer={linkedPointerVisible}
                          pointerPosition={pointerPosition}
                          onPointerPositionChange={queuePointerPosition}
                          initialImageView={restoreImageView}
                          onViewerReady={(v) => {
                            quadRefs.current[paneIdx] = v
                            consumeRestoredImageView()
                          }}
                        />
                        <div className={`split-view-label quad-view-label-${paneIdx + 1}`}>{getCompareSourceLabel(source, paneIdx)}</div>
                      </div>
                    )
                  })}
                </div>
              ) : compareMode === 'overlay' ? (
                <div style={{ position: 'absolute', inset: 0 }}>
                  <OpenSeadragonViewer
                    tileSource={getCompareTileSource(overlayBaseViz, 0)}
                    label={getCompareSourceLabel(overlayBaseViz, 0)}
                    fallbackUrl={selectedArtwork.hero}
                    linkedPointer={linkedPointerVisible}
                    pointerPosition={pointerPosition}
                    onPointerPositionChange={queuePointerPosition}
                    initialImageView={restoreImageView}
                    onViewerReady={(v) => {
                      overlayBaseRef.current = v
                      primaryViewerRef.current = v
                      consumeRestoredImageView()
                    }}
                  />
                  <div style={{ position: 'absolute', inset: 0, opacity: overlayOpacity, pointerEvents: 'none', transition: 'opacity 0.1s' }}>
                    <OpenSeadragonViewer
                      tileSource={getCompareTileSource(overlayViz, 1)}
                      label={getCompareSourceLabel(overlayViz, 1)}
                      fallbackUrl={selectedArtwork.hero}
                      linkedPointer={linkedPointerVisible}
                      pointerPosition={pointerPosition}
                      onPointerPositionChange={queuePointerPosition}
                      initialImageView={restoreImageView}
                      onViewerReady={(v) => {
                        overlayTopRef.current = v
                        consumeRestoredImageView()
                      }}
                    />
                  </div>
                </div>
              ) : isBandModeActive && (selectedArtwork?.bandImages?.length ?? 0) > 0 ? (
                <BandViewer
                  bandImages={selectedArtwork!.bandImages!}
                  wavelength={band}
                  zoomControllerRef={bandZoomControllerRef}
                />
              ) : (
                <OpenSeadragonViewer
                  tileSource={activeTileSource}
                  fallbackUrl={selectedArtwork.hero}
                  label={currentVisualization?.label}
                  linkedPointer={linkedPointerVisible}
                  pointerPosition={pointerPosition}
                  onPointerPositionChange={queuePointerPosition}
                  initialImageView={restoreImageView}
                  onViewerReady={(v) => {
                    primaryViewerRef.current = v
                    consumeRestoredImageView()
                  }}
                />
              )}

              <div className="viewer-overlay viewer-overlay-bottom">
                {!isBandModeActive && compareMode === 'single' && (
                  <div className="viewer-mode-chip">
                    <span>{currentVisualization.label}</span>
                  </div>
                )}
                <div className="viewer-bottom-right-controls">
                  <div className="viewer-zoom-controls">
                    <button
                      className="zoom-btn"
                      aria-label="Zoom out"
                      title="Zoom out"
                      onClick={() => zoomActiveViewers(0.7)}
                    >－</button>
                    <button
                      className="zoom-btn"
                      aria-label="Fit to screen"
                      title="Fit to screen"
                      onClick={fitActiveViewers}
                    >⊡</button>
                    <button
                      className="zoom-btn"
                      aria-label="Zoom in"
                      title="Zoom in"
                      onClick={() => zoomActiveViewers(1.4)}
                    >＋</button>
                  </div>
                </div>
              </div>
            </div>
            {activeToolPanel === 'visualization' && isBandModeActive && (selectedArtwork.bandImages?.length ?? 0) > 0 && (
              <div
                className={`band-control-strip placement-${bandControlPlacement}`}
                style={bandControlPlacement === 'overlay'
                  ? { background: `rgba(14, 14, 18, ${bandPanelOpacity / 100})` }
                  : undefined}
              >
                <div className="band-control-heading">
                  <strong>
                    Band {selectedBandInfo ? selectedBandInfo.bandIndex + 1 : '—'}
                    <span> · {band} nm</span>
                  </strong>
                  <button
                    className="band-control-done"
                    onClick={() => {
                      setIsControlPanelOpen(false)
                      setActiveToolPanel('artwork')
                    }}
                  >Done</button>
                </div>
                <label className="visually-hidden" htmlFor="band-slider">Select spectral wavelength</label>
                <input
                  id="band-slider"
                  className="band-touch-slider"
                  type="range"
                  min={Math.min(...selectedArtwork.bandImages!.map((item) => item.wavelength ?? item.bandIndex))}
                  max={Math.max(...selectedArtwork.bandImages!.map((item) => item.wavelength ?? item.bandIndex))}
                  step={1}
                  value={band}
                  onInput={(event) => setBand(Number((event.target as HTMLInputElement).value))}
                />
              </div>
            )}
          </div>

          <aside className={isControlPanelOpen ? 'viewer-tools open' : 'viewer-tools'}>
            {!isControlPanelOpen && (
              <button
                className="drawer-handle"
                onClick={() => setIsControlPanelOpen(true)}
                aria-label="Open tools drawer"
                title="Open tools"
              >
                <span className="drawer-handle-chevron">‹</span>
                <span className="drawer-handle-label">Tools</span>
              </button>
            )}

            {isControlPanelOpen && (
              <>
                <div className="tool-rail" aria-label="Viewer tools">
                  {toolPanels.map((panel) => (
                    <button
                      key={panel.id}
                      className={panel.id === activeToolPanel ? 'tool-rail-button active' : 'tool-rail-button'}
                      onClick={() => openToolPanel(panel.id)}
                      title={panel.label}
                      aria-label={panel.label}
                      aria-pressed={panel.id === activeToolPanel}
                    >
                      {panel.shortLabel}
                    </button>
                  ))}
                  <button
                    className="drawer-close-button"
                    onClick={() => setIsControlPanelOpen(false)}
                    aria-label="Close tools drawer"
                    title="Close tools"
                  >
                    ×
                  </button>
                </div>

                <div className="drawer-backdrop" onClick={() => setIsControlPanelOpen(false)} />

                <div className="control-panel open">
                  {activeToolPanel === 'artwork' && (
                    <div className="panel-block">
                      <p className="eyebrow">Artwork</p>
                      <h2>{selectedArtwork.title}</h2>
                      <p>
                        {selectedArtwork.artist} · {selectedArtwork.year}
                      </p>
                      <p className="support-copy">{currentVisualization.description}</p>
                    </div>
                  )}

                  {activeToolPanel === 'visualization' && (
                    <div className="panel-block">
                      <div className="chip-list viz-choice-list">
                        {[...availableVisualizations]
                          .filter((item) => visualizationOrder.includes(item.id))
                          .sort((a, b) => visualizationOrder.indexOf(a.id) - visualizationOrder.indexOf(b.id))
                          .map((item) => (
                          <button
                            key={item.id}
                            className={item.id === currentVisualization.id ? 'chip active' : 'chip'}
                            onClick={() => {
                              if (!item.available) return
                              setSelectedVisualization(item.id)
                              setIsBandModeActive(false)
                            }}
                            disabled={!item.available}
                            aria-disabled={!item.available}
                            title={item.available ? item.description : `${item.label} not available for this artwork`}
                          >
                            {item.id === 'falseColor' ? 'False color' : item.id === 'xray' ? 'X-Ray' : item.label}
                          </button>
                        ))}
                      </div>
                      <div className="band-mode-section">
                        <button
                          className={isBandModeActive ? 'chip active' : 'chip'}
                          aria-pressed={isBandModeActive}
                          onClick={() => setIsBandModeActive(true)}
                          disabled={!selectedArtwork.bandImages?.length}
                        >Explore Bands</button>
                        {isBandModeActive && (
                          <>
                            <div className="band-layout-toggle" role="group" aria-label="Band slider layout">
                              <button
                                className={bandControlPlacement === 'overlay' ? 'chip active' : 'chip'}
                                aria-pressed={bandControlPlacement === 'overlay'}
                                onClick={() => setBandControlPlacement('overlay')}
                              >Overlay</button>
                              <button
                                className={bandControlPlacement === 'below' ? 'chip active' : 'chip'}
                                aria-pressed={bandControlPlacement === 'below'}
                                onClick={() => setBandControlPlacement('below')}
                              >Below image</button>
                            </div>
                            {bandControlPlacement === 'overlay' && (
                              <div className="band-panel-opacity-control">
                                <label htmlFor="band-panel-opacity">
                                  <span>Panel opacity</span>
                                  <output htmlFor="band-panel-opacity">{bandPanelOpacity}%</output>
                                </label>
                                <input
                                  id="band-panel-opacity"
                                  className="band-touch-slider"
                                  type="range"
                                  min={0}
                                  max={30}
                                  step={1}
                                  value={bandPanelOpacity}
                                  aria-label="Band panel opacity"
                                  onChange={(event) => setBandPanelOpacity(Number(event.target.value))}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {activeToolPanel === 'compare' && (
                    <div className="panel-block">
                      <button className="secondary-button share-view-button" onClick={() => void shareCurrentView()}>
                        Copy share link
                      </button>
                      {shareFeedback && <p className="share-view-feedback" role="status">{shareFeedback}</p>}
                      {compareMode !== 'single' && (
                        <label className="compare-label-option">
                          <input
                            type="checkbox"
                            checked={showCompareLabels}
                            onChange={(event) => setShowCompareLabels(event.target.checked)}
                          />
                          Show image labels
                        </label>
                      )}
                      {compareMode !== 'single' && compareMode !== 'focusQuad' && (
                        <label className="linked-pointer-option">
                          <input
                            type="checkbox"
                            checked={linkedPointer}
                            onChange={(event) => setLinkedPointer(event.target.checked)}
                          />
                          Linked pointer
                        </label>
                      )}
                      <div className="chip-list">
                        {compareModes.map((mode) => (
                          <button
                            key={mode.id}
                            className={mode.id === compareMode ? 'chip active' : 'chip'}
                            onClick={() => { resetViewerRefs(); setCompareMode(mode.id) }}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                      {compareMode !== 'single' && (
                        <label className="sync-views-option">
                          <input
                            type="checkbox"
                            checked={syncZoom || compareMode === 'focusQuad'}
                            disabled={compareMode === 'focusQuad'}
                            onChange={(event) => setSyncZoom(event.target.checked)}
                          />
                          Sync views{compareMode === 'focusQuad' ? ' (always on)' : ''}
                        </label>
                      )}

                      {compareMode === 'curtain' && (
                        <>
                          {renderCompareSourceSelect('Left image', curtainLeftViz, 0, setCurtainLeftViz)}
                          {renderCompareSourceSelect('Right image', curtainRightViz, 1, setCurtainRightViz)}
                        </>
                      )}

                      {compareMode === 'split' && (
                        <>
                          {renderCompareSourceSelect('Left image', splitLeftViz, 0, setSplitLeftViz)}
                          {renderCompareSourceSelect('Right image', splitRightViz, 1, setSplitRightViz)}
                        </>
                      )}

                      {compareMode === 'quad' && (
                        <div className="focus-quad-source-grid">
                          {quadVizIds.map((vizId, i) => (
                            <div key={i}>
                              {renderCompareSourceSelect(`Image ${String.fromCharCode(65 + i)}`, vizId, i, (next) => setQuadVizIds((prev) => prev.map((id, j) => j === i ? next : id)))}
                            </div>
                          ))}
                        </div>
                      )}

                      {compareMode === 'focusQuad' && (
                        <div className="focus-quad-source-grid">
                          {quadVizIds.map((vizId, i) => (
                            <div key={i}>
                              {renderCompareSourceSelect(`Quadrant ${String.fromCharCode(65 + i)}`, vizId, i, (next) => setQuadVizIds((prev) => prev.map((id, j) => j === i ? next : id)))}
                            </div>
                          ))}
                        </div>
                      )}

                      {bandSourcePanes.length > 0 && sortedBandImages.length > 0 && (
                        <div className="compare-band-control">
                          {bandSourcePanes.length > 1 && (
                            <>
                              <p className="eyebrow">Adjust band for</p>
                              <div className="chip-list compare-band-pane-list">
                                {bandSourcePanes.map((pane) => (
                                  <button
                                    key={pane}
                                    className={selectedCompareBandPane === pane ? 'chip active' : 'chip'}
                                    aria-pressed={selectedCompareBandPane === pane}
                                    onClick={() => setActiveBandPane(pane)}
                                  >{String.fromCharCode(65 + pane)}</button>
                                ))}
                              </div>
                            </>
                          )}
                          {(() => {
                            const targetPane = selectedCompareBandPane ?? 0
                            const bandIndex = comparisonBandIndices[targetPane] ?? 0
                            const item = sortedBandImages[Math.min(sortedBandImages.length - 1, bandIndex)]
                            return (
                              <>
                                <label className="slider-label" htmlFor="compare-band-slider">
                                  <strong>Band {item.bandIndex + 1}</strong> · {item.wavelength ?? item.bandIndex} nm
                                </label>
                                <input
                                  id="compare-band-slider"
                                  className="band-touch-slider"
                                  type="range"
                                  min={0}
                                  max={sortedBandImages.length - 1}
                                  step={1}
                                  value={Math.min(sortedBandImages.length - 1, bandIndex)}
                                  onChange={(event) => {
                                    const next = Number(event.target.value)
                                    setComparisonBandIndices((current) => {
                                      const updated = [...current]
                                      updated[targetPane] = next
                                      if (linkBands) bandSourcePanes.forEach((pane) => { updated[pane] = next })
                                      return updated
                                    })
                                  }}
                                  aria-label="Select comparison band"
                                />
                              </>
                            )
                          })()}
                          {bandSourcePanes.length > 1 && (
                            <label className="linked-pointer-option compare-link-bands-option">
                              <input type="checkbox" checked={linkBands} onChange={(event) => {
                                const enabled = event.target.checked
                                setLinkBands(enabled)
                                if (enabled) {
                                  const linkedIndex = comparisonBandIndices[selectedCompareBandPane ?? 0] ?? 0
                                  setComparisonBandIndices((current) => {
                                    const updated = [...current]
                                    bandSourcePanes.forEach((pane) => { updated[pane] = linkedIndex })
                                    return updated
                                  })
                                }
                              }} />
                              Link bands
                            </label>
                          )}
                        </div>
                      )}

                      {compareMode === 'overlay' && (
                        <>
                          {renderCompareSourceSelect('Base image', overlayBaseViz, 0, setOverlayBaseViz)}
                          {renderCompareSourceSelect('Overlay image', overlayViz, 1, setOverlayViz)}
                          <p className="eyebrow" style={{ marginTop: '16px' }}>
                            Opacity — {Math.round(overlayOpacity * 100)}%
                          </p>
                          <input
                            className="band-touch-slider"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={overlayOpacity}
                            onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                            style={{ width: '100%' }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </section>
      )}
    </div>
  )
}

export default App

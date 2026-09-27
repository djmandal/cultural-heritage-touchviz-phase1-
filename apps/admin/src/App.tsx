import { useEffect, useMemo, useState } from 'react'
import './App.css'

type HealthResponse = {
  status?: string
}

type DatasetListItem = {
  id: string
  title: string
  artist?: string
  year?: string
  collection?: string
  thumbnail?: string
  hero?: string
  availableVisualizations?: string[]
}

type DatasetListResponse = {
  items?: DatasetListItem[]
}

type DatasetVisualization = {
  id: string
  label: string
  available: boolean
  sourceType?: string
  imageUrl?: string | null
  tileSource?: string | null
}

type DatasetSourceFile = {
  name: string
  relativePath: string
  size: number
}

type DatasetProcessing = {
  status?: string
  sourceType?: string
  requestedOutputs?: string[]
  completedOutputs?: string[]
  failedOutputs?: string[]
}

type DatasetDetail = {
  id: string
  title: string
  artist: string
  year: string
  collection: string
  visualizations?: DatasetVisualization[]
  sourceFiles?: DatasetSourceFile[]
  processing?: DatasetProcessing | null
}

type DatasetDetailResponse = {
  item?: DatasetDetail
}


type UploadOutputOption = 'rgb' | 'falseColor' | 'bands' | 'iiif'

type UploadFormState = {
  id: string
  title: string
  artist: string
  year: string
  collection: string
}

type UploadResponse = {
  requestedOutputs?: string[]
  completedOutputs?: string[]
}

type AdminAuthStatus = 'checking' | 'signed-out' | 'signed-in'

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL
const browserHost = window.location.hostname || '127.0.0.1'
const apiBaseUrl = (() => {
  const configuredBaseUrl = rawApiBaseUrl?.trim()
  if (configuredBaseUrl) {
    try {
      const configuredUrl = new URL(configuredBaseUrl)
      const configuredHost = configuredUrl.hostname.toLowerCase()
      const isLoopbackHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(configuredHost)
      if (isLoopbackHost && configuredUrl.hostname !== browserHost) {
        configuredUrl.hostname = browserHost
      }
      return configuredUrl.toString().replace(/\/$/, '')
    } catch {
      // Fall back to the current browser host when the optional URL is invalid.
    }
  }
  return `http://${browserHost}:8000`
})()

const adminDatasetsUrl = `${apiBaseUrl}/admin/datasets`

const uploadOutputOptions: { id: UploadOutputOption; label: string }[] = [
  { id: 'rgb', label: 'RGB preview' },
  { id: 'falseColor', label: 'False color preview' },
  { id: 'bands', label: 'Band previews' },
  { id: 'iiif', label: 'IIIF high-resolution viewing' },
]

function App() {
  const [healthStatus, setHealthStatus] = useState<'loading' | 'online' | 'offline'>(
    'loading',
  )
  const [authStatus, setAuthStatus] = useState<AdminAuthStatus>('checking')
  const [adminPassword, setAdminPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [healthMessage, setHealthMessage] = useState('Checking backend connection...')
  const [datasets, setDatasets] = useState<DatasetListItem[]>([])
  const [datasetsLoading, setDatasetsLoading] = useState(true)
  const [datasetsError, setDatasetsError] = useState('')

  const [uploadForm, setUploadForm] = useState<UploadFormState>({
    id: '',
    title: '',
    artist: '',
    year: '',
    collection: '',
  })
  const [selectedUploadOutputs, setSelectedUploadOutputs] = useState<UploadOutputOption[]>(
    ['rgb', 'iiif'],
  )
  const [hdrFile, setHdrFile] = useState<File | null>(null)
  const [imgFile, setImgFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [selectedDatasetId, setSelectedDatasetId] = useState('')
  const [selectedDataset, setSelectedDataset] = useState<DatasetDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailMessage, setDetailMessage] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  const adminFetch = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, credentials: 'include' })
    if (response.status === 401) {
      setAuthStatus('signed-out')
      setAuthMessage('Your Admin session ended. Sign in again to continue.')
    }
    return response
  }

  const loadHealth = async () => {
    const healthUrl = `${apiBaseUrl}/health`

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error(`Health request failed with ${response.status}`)
      }

      const data = (await response.json()) as HealthResponse
      setHealthStatus('online')
      setHealthMessage(data.status ? `Backend ${data.status}` : 'Backend online')
    } catch (error) {
      setHealthStatus('offline')

      if (error instanceof Error) {
        setHealthMessage(`Backend unavailable: ${error.message}`)
      } else {
        setHealthMessage(`Backend unavailable: unknown error`)
      }
    }
  }

  const loadDatasets = async () => {
    setDatasetsLoading(true)
    setDatasetsError('')

    try {
      const response = await adminFetch(adminDatasetsUrl)
      if (!response.ok) {
        throw new Error(`Datasets request failed with ${response.status}`)
      }

      const data = (await response.json()) as DatasetListResponse
      setDatasets(data.items ?? [])
    } catch {
      setDatasets([])
      setDatasetsError('Unable to load datasets from the backend.')
    } finally {
      setDatasetsLoading(false)
    }
  }

  const loadDatasetDetail = async (datasetId: string) => {
    setSelectedDatasetId(datasetId)
    setDetailLoading(true)
    setDetailMessage('')

    try {
      const response = await adminFetch(`${adminDatasetsUrl}/${datasetId}`)
      if (!response.ok) {
        throw new Error(`Dataset detail request failed with ${response.status}`)
      }

      const data = (await response.json()) as DatasetDetailResponse
      setSelectedDataset(data.item ?? null)
    } catch {
      setSelectedDataset(null)
      setDetailMessage('Unable to load dataset details.')
    } finally {
      setDetailLoading(false)
    }
  }

  const checkAdminSession = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/admin/auth/session`, {
        credentials: 'include',
      })
      if (!response.ok) {
        setAuthStatus('signed-out')
        return
      }
      setAuthStatus('signed-in')
      await loadDatasets()
    } catch {
      setAuthStatus('signed-out')
      setAuthMessage('Unable to verify Admin login. Check that the backend is running.')
    }
  }

  const handleAdminLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSigningIn(true)
    setAuthMessage('')
    try {
      const response = await fetch(`${apiBaseUrl}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: adminPassword }),
      })
      const result = (await response.json()) as { detail?: string }
      if (!response.ok) throw new Error(result.detail ?? 'Admin login failed.')
      setAdminPassword('')
      setAuthStatus('signed-in')
      await loadDatasets()
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Admin login failed.')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleAdminLogout = async () => {
    try {
      const response = await adminFetch(`${apiBaseUrl}/admin/auth/logout`, { method: 'POST' })
      if (!response.ok) throw new Error('Unable to end the Admin session.')
      setAuthStatus('signed-out')
      setSelectedDataset(null)
      setSelectedDatasetId('')
      setDatasets([])
      setAuthMessage('You are signed out.')
    } catch {
      setAuthMessage('Could not sign out. Check the backend connection and try again.')
    }
  }

  useEffect(() => {
    loadHealth()
    checkAdminSession()
  }, [])

  const handleUploadOutputToggle = (outputId: UploadOutputOption) => {
    setSelectedUploadOutputs((current) => {
      if (current.includes(outputId)) {
        const next = current.filter((item) => item !== outputId)
        return next.length > 0 ? next : ['rgb']
      }

      return [...current, outputId]
    })
  }

  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const { name, value } = event.target
    setUploadForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleDatasetUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!hdrFile || !imgFile) {
      setUploadMessage('Please choose both HDR and IMG files.')
      return
    }

    setIsUploading(true)
    setUploadMessage('Uploading dataset...')

    try {
      const formData = new FormData()
      formData.append('id', uploadForm.id)
      formData.append('title', uploadForm.title)
      formData.append('artist', uploadForm.artist)
      formData.append('year', uploadForm.year)
      formData.append('collection', uploadForm.collection)
      formData.append('requested_outputs', selectedUploadOutputs.join(','))
      formData.append('hdr_file', hdrFile)
      formData.append('img_file', imgFile)

      const response = await adminFetch(`${adminDatasetsUrl}/upload`, {
        method: 'POST',
        body: formData,
      })

      const result = (await response.json()) as UploadResponse & { detail?: string }

      if (!response.ok) {
        // Still reload datasets — upload may have partially succeeded
        await loadDatasets()
        throw new Error(result.detail ?? `Upload failed with status ${response.status}.`)
      }

      setUploadMessage(
        `Upload complete. Requested: ${(result.requestedOutputs ?? []).join(', ') || 'rgb'} | Completed: ${(result.completedOutputs ?? []).join(', ') || 'none yet'}`,
      )

      setUploadForm({
        id: '',
        title: '',
        artist: '',
        year: '',
        collection: '',
      })
      setSelectedUploadOutputs(['rgb', 'iiif'])
      setHdrFile(null)
      setImgFile(null)

      await loadDatasets()
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleRegenerateDataset = async (datasetId: string) => {
    setSelectedDatasetId(datasetId)
    setActionMessage(`Regenerating ${datasetId}...`)

    try {
      const response = await adminFetch(`${adminDatasetsUrl}/${datasetId}/regenerate`, {
        method: 'POST',
      })

      const result = (await response.json()) as { message?: string; detail?: string }

      if (!response.ok) {
        throw new Error(result.detail ?? 'Regeneration failed.')
      }

      setActionMessage(result.message ?? 'Dataset regenerated.')
      await loadDatasets()
      await loadDatasetDetail(datasetId)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Regeneration failed.')
    }
  }

  const handleDeleteDataset = async (datasetId: string) => {
    const confirmed = window.confirm(
      `Delete dataset "${datasetId}"? This removes raw and derived files.`,
    )

    if (!confirmed) return

    setActionMessage(`Deleting ${datasetId}...`)

    try {
      const response = await adminFetch(`${adminDatasetsUrl}/${datasetId}`, {
        method: 'DELETE',
      })

      const result = (await response.json()) as { message?: string; detail?: string }

      if (!response.ok) {
        throw new Error(result.detail ?? 'Delete failed.')
      }

      setActionMessage(result.message ?? 'Dataset deleted.')
      setSelectedDataset(null)
      setSelectedDatasetId('')
      await loadDatasets()
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Delete failed.')
    }
  }

  const datasetCountLabel = useMemo(() => {
    if (datasetsLoading) return 'Loading...'
    return `${datasets.length} available`
  }, [datasets.length, datasetsLoading])

  const processingLabel = useMemo(() => {
    if (healthStatus === 'loading') return 'Checking...'
    if (healthStatus === 'online') return 'Connected'
    return 'Needs attention'
  }, [healthStatus])

  if (authStatus !== 'signed-in') {
    return (
      <main className="admin-login-shell">
        <section className="admin-login-card">
          <p className="eyebrow">Cultural Heritage Touch-VIZ</p>
          <h1>Admin sign in</h1>
          <p className="support-copy">Sign in to manage collection datasets.</p>
          {authStatus === 'checking' ? (
            <p className="support-copy">Checking Admin session…</p>
          ) : (
            <form className="admin-login-form" onSubmit={handleAdminLogin}>
              <label className="field">
                <span>Admin password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  required
                />
              </label>
              {authMessage && <p className="auth-message" role="alert">{authMessage}</p>}
              <button className="primary-button" type="submit" disabled={isSigningIn}>
                {isSigningIn ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </section>
      </main>
    )
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">Cultural Heritage Touch-VIZ</p>
          <h1>Administration</h1>
        </div>

        <div className={`admin-status status-${healthStatus}`}>
          <span className="status-dot" />
          <span>{healthMessage}</span>
        </div>
        <button className="secondary-button admin-logout" type="button" onClick={handleAdminLogout}>
          Sign out
        </button>
      </header>

      <main className="admin-main">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Staff workspace</p>
            <h2>Manage uploads, processing, and published datasets.</h2>
            <p className="support-copy">
              This admin application is separate from the museum kiosk and is intended
              for internal collection and imaging operations only.
            </p>
          </div>

          <div className="hero-metrics">
            <article className="metric-card">
              <span className="metric-label">Uploads</span>
              <strong>{isUploading ? 'Running...' : 'Ready'}</strong>
            </article>
            <article className="metric-card">
              <span className="metric-label">Processing</span>
              <strong>{processingLabel}</strong>
            </article>
            <article className="metric-card">
              <span className="metric-label">Datasets</span>
              <strong>{datasetCountLabel}</strong>
            </article>
          </div>
        </section>

        <section className="admin-grid">
          <article className="admin-card">
            <div className="card-head">
              <p className="eyebrow">Upload intake</p>
              <h3>New dataset upload</h3>
            </div>

            <form className="upload-form" onSubmit={handleDatasetUpload}>
              <div className="form-grid">
                <label className="field">
                  <span>Dataset ID</span>
                  <input
                    name="id"
                    type="text"
                    value={uploadForm.id}
                    onChange={handleInputChange}
                    placeholder="night-watch-study"
                    required
                  />
                </label>

                <label className="field">
                  <span>Title</span>
                  <input
                    name="title"
                    type="text"
                    value={uploadForm.title}
                    onChange={handleInputChange}
                    placeholder="Night Watch Study"
                    required
                  />
                </label>

                <label className="field">
                  <span>Artist</span>
                  <input
                    name="artist"
                    type="text"
                    value={uploadForm.artist}
                    onChange={handleInputChange}
                    placeholder="Workshop Collection"
                  />
                </label>

                <label className="field">
                  <span>Year</span>
                  <input
                    name="year"
                    type="text"
                    value={uploadForm.year}
                    onChange={handleInputChange}
                    placeholder="1642"
                  />
                </label>

                <label className="field field-wide">
                  <span>Collection</span>
                  <input
                    name="collection"
                    type="text"
                    value={uploadForm.collection}
                    onChange={handleInputChange}
                    placeholder="Conservation Imaging Demo"
                  />
                </label>
              </div>

              <div className="upload-options">
                <span className="field-label">Requested outputs</span>
                <div className="checkbox-grid">
                  {uploadOutputOptions.map((option) => (
                    <label key={option.id} className="checkbox-pill">
                      <input
                        type="checkbox"
                        checked={selectedUploadOutputs.includes(option.id)}
                        onChange={() => handleUploadOutputToggle(option.id)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="file-grid">
                <label className="field">
                  <span>HDR file</span>
                  <input
                    type="file"
                    accept=".hdr"
                    onChange={(event) => setHdrFile(event.target.files?.[0] ?? null)}
                    required
                  />
                </label>

                <label className="field">
                  <span>IMG file</span>
                  <input
                    type="file"
                    accept=".img"
                    onChange={(event) => setImgFile(event.target.files?.[0] ?? null)}
                    required
                  />
                </label>
              </div>

              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={isUploading}>
                  {isUploading ? 'Uploading…' : 'Upload dataset'}
                </button>
                <span className="support-copy">
                  HDR and IMG files are uploaded together as one dataset package.
                </span>
              </div>

              {uploadMessage && (
                <p
                  className={`upload-message ${uploadMessage.toLowerCase().includes('failed') || uploadMessage.toLowerCase().includes('please') ? 'upload-message-error' : 'upload-message-info'}`}
                >
                  {uploadMessage}
                </p>
              )}
            </form>
          </article>

          <article className="admin-card">
            <div className="card-head">
              <p className="eyebrow">Processing</p>
              <h3>Pipeline status</h3>
            </div>
            <p className="support-copy">
              This area will show processing jobs, validation state, generated outputs,
              and publication readiness.
            </p>
          </article>

          <article className="admin-card admin-card-wide">
            <div className="card-head">
              <p className="eyebrow">Dataset management</p>
              <h3>Collection records</h3>
            </div>

            {datasetsLoading && (
              <p className="support-copy">Loading datasets from the backend...</p>
            )}

            {!datasetsLoading && datasetsError && (
              <p className="support-copy error-copy">{datasetsError}</p>
            )}

            {!datasetsLoading && !datasetsError && datasets.length === 0 && (
              <p className="support-copy">
                No datasets are currently available from the backend.
              </p>
            )}

            {!datasetsLoading && !datasetsError && datasets.length > 0 && (
              <>
                <div className="dataset-list">
                  {datasets.map((dataset) => {
                    const isSelected = selectedDatasetId === dataset.id

                    return (
                      <div
                        key={dataset.id}
                        className={`dataset-entry ${isSelected ? 'dataset-entry-selected' : ''}`}
                      >
                        <article className="dataset-row">
                          <div className="dataset-row-main">
                            <strong>{dataset.title}</strong>
                            <span className="dataset-meta">
                              {dataset.artist || 'Unknown artist'}
                              {dataset.year ? ` · ${dataset.year}` : ''}
                              {dataset.collection ? ` · ${dataset.collection}` : ''}
                            </span>
                          </div>

                          <div className="dataset-row-side">
                            <span className="dataset-id">{dataset.id}</span>
                            <span className="dataset-count">
                              {dataset.availableVisualizations?.length ?? 0} visualizations
                            </span>
                            <div className="dataset-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => {
                                  if (selectedDatasetId === dataset.id && selectedDataset) {
                                    setSelectedDatasetId('')
                                    setSelectedDataset(null)
                                    setDetailMessage('')
                                    setActionMessage('')
                                    return
                                  }

                                  loadDatasetDetail(dataset.id)
                                }}
                              >
                                {isSelected && selectedDataset ? 'Hide' : 'Inspect'}
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => handleRegenerateDataset(dataset.id)}
                              >
                                Regenerate
                              </button>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() => handleDeleteDataset(dataset.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </article>

                        {isSelected && (
                          <div className="dataset-detail-panel dataset-detail-panel-inline">
                            {actionMessage && <p className="support-copy">{actionMessage}</p>}

                            <div className="card-head">
                              <p className="eyebrow">Dataset detail</p>
                              <h3>
                                {selectedDataset
                                  ? `${selectedDataset.title} (${selectedDataset.id})`
                                  : selectedDatasetId || 'Selection'}
                              </h3>
                            </div>

                            {detailLoading && (
                              <p className="support-copy">Loading dataset detail...</p>
                            )}

                            {!detailLoading && detailMessage && (
                              <p className="support-copy error-copy">{detailMessage}</p>
                            )}

                            {!detailLoading && selectedDataset && (
                              <div className="detail-grid">
                                <div>
                                  <h4>Processing</h4>
                                  <p className="support-copy">
                                    Status: {selectedDataset.processing?.status ?? 'unknown'}
                                  </p>
                                  <p className="support-copy">
                                    Requested:{' '}
                                    {selectedDataset.processing?.requestedOutputs?.join(', ') ||
                                      '—'}
                                  </p>
                                  <p className="support-copy">
                                    Completed:{' '}
                                    {selectedDataset.processing?.completedOutputs?.join(', ') ||
                                      '—'}
                                  </p>
                                  <p className="support-copy">
                                    Failed:{' '}
                                    {selectedDataset.processing?.failedOutputs?.join(', ') || '—'}
                                  </p>
                                </div>

                                <div>
                                  <h4>Source files</h4>
                                  {selectedDataset.sourceFiles?.length ? (
                                    <ul className="detail-list">
                                      {selectedDataset.sourceFiles.map((file) => (
                                        <li key={file.relativePath}>
                                          {file.name} · {file.size} bytes
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="support-copy">No source files listed.</p>
                                  )}
                                </div>

                                <div className="detail-span">
                                  <h4>Visualizations</h4>
                                  {selectedDataset.visualizations?.length ? (
                                    <ul className="detail-list">
                                      {selectedDataset.visualizations.map((viz) => (
                                        <li key={viz.id}>
                                          {viz.label} ·{' '}
                                          {viz.available ? 'available' : 'not available'} ·{' '}
                                          {viz.sourceType ?? 'unknown source'}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="support-copy">No visualizations listed.</p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </article>
        </section>
      </main>
    </div>
  )
}

export default App

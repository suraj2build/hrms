import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, FileText, Download, Trash2, Search, AlertTriangle, Loader2, File } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { PageHeader } from '@/components/layout/PageHeader'
import { formatDate } from '@/lib/utils'
import type { Document, DocType } from '@/types'

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'aadhaar', label: 'Aadhaar Card' },
  { value: 'pan', label: 'PAN Card' },
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'contract', label: 'Employment Contract' },
  { value: 'certificate', label: 'Certificate / Degree' },
  { value: 'relieving_letter', label: 'Relieving Letter' },
  { value: 'experience_letter', label: 'Experience Letter' },
  { value: 'other', label: 'Other' },
]

function formatBytes(bytes?: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function Documents() {
  const { tenant, profile } = useAuthStore()

  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [uploadDialog, setUploadDialog] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadMeta, setUploadMeta] = useState({
    employee_id: '',
    doc_type: 'other' as DocType,
    expires_at: '',
  })
  const fileRef = useRef<HTMLInputElement>(null)

  // Documents list
  const { data, isLoading } = useQuery<{ data: Document[] }>({
    queryKey: ['documents', typeFilter],
    queryFn: () => api.get(`/documents${typeFilter !== 'all' ? `?doc_type=${typeFilter}` : ''}`),
    staleTime: 30_000,
  })


  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      // Same backend documents table is also shown on the employee profile's
      // documents tab (['emp-docs', id]) and ESS (['ess-documents', employeeId]) —
      // invalidate by prefix so a delete from the HR vault doesn't leave those
      // other two views showing a document that no longer exists.
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['emp-docs'] })
      queryClient.invalidateQueries({ queryKey: ['ess-documents'] })
      toast.success('Document deleted')
    },
    onError: (e: Error) => toast.error('Failed to delete document', { description: e.message }),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
  }

  async function handleUpload() {
    if (!selectedFile || !uploadMeta.employee_id) {
      toast.error('Select an employee and a file')
      return
    }

    setUploading(true)
    try {
      const ext = selectedFile.name.split('.').pop()
      const path = `${tenant?.id}/${uploadMeta.employee_id}/${Date.now()}.${ext}`

      // Fresh audit finding: this page uploaded to a bucket named 'documents',
      // which was never created by any migration (see supabase/migrations —
      // only 'employee-files' and 'attendance-uploads' exist). The backend
      // (routes/documents/index.ts) already migrated its own storage calls to
      // 'employee-files' — this page was never updated to match, so uploads
      // here would fail outright ("Bucket not found"). The tenant-first-
      // segment path convention above already matches employee-files' RLS
      // policy (migration 385), so only the bucket name needed correcting.
      const { error: storageError } = await supabase.storage
        .from('employee-files')
        .upload(path, selectedFile, { upsert: false })

      if (storageError) throw new Error(storageError.message)

      await api.post('/documents', {
        employee_id: uploadMeta.employee_id,
        doc_type: uploadMeta.doc_type,
        name: selectedFile.name,
        storage_path: path,
        file_size: selectedFile.size,
        mime_type: selectedFile.type,
        expires_at: uploadMeta.expires_at || undefined,
      })

      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['emp-docs'] })
      queryClient.invalidateQueries({ queryKey: ['ess-documents'] })
      toast.success('Document uploaded successfully')
      setUploadDialog(false)
      setSelectedFile(null)
      setUploadMeta({ employee_id: '', doc_type: 'other', expires_at: '' })
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(doc: Document) {
    const { data: signedUrl, error } = await supabase.storage
      .from('employee-files')
      .createSignedUrl(doc.storage_path, 60)

    if (error || !signedUrl) {
      toast.error('Failed to generate download link')
      return
    }
    window.open(signedUrl.signedUrl, '_blank')
  }

  const filtered = (data?.data ?? []).filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  )

  const expiringDocs = filtered.filter(
    (d) => d.expires_at && new Date(d.expires_at) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  )

  if (!['super_admin', 'hr_admin'].includes(profile?.role ?? '')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <p className="text-sm text-muted-foreground font-medium">Access restricted to HR administrators.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Document Vault"
        subtitle={`${data?.data?.length ?? 0} documents stored`}
        actions={
          <Button size="sm" onClick={() => setUploadDialog(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Document
          </Button>
        }
      />

      {/* Expiry alert */}
      {expiringDocs.length > 0 && (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0" />
            <p className="text-sm text-warning">
              <span className="font-semibold">{expiringDocs.length} document{expiringDocs.length > 1 ? 's' : ''}</span>
              {' '}expiring within 30 days. Review and renew.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Document list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-14 bg-muted rounded animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No documents found.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setUploadDialog(true)}>
                Upload your first document
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Document', 'Type', 'Size', 'Expires', 'Uploaded'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => {
                  const isExpiring = doc.expires_at &&
                    new Date(doc.expires_at) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                  return (
                    <tr key={doc.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded bg-info/20">
                            <File className="h-3.5 w-3.5 text-info" />
                          </div>
                          <span className="font-medium truncate max-w-[180px]">{doc.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-[10px]">
                          {DOC_TYPES.find((t) => t.value === doc.doc_type)?.label ?? doc.doc_type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatBytes(doc.file_size)}</td>
                      <td className="px-4 py-3">
                        {doc.expires_at ? (
                          <span className={isExpiring ? 'text-warning font-medium' : 'text-muted-foreground'}>
                            {isExpiring && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                            {formatDate(doc.expires_at)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(doc.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(doc)}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteMutation.mutate(doc.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={uploadDialog} onOpenChange={(o) => { setUploadDialog(o); if (!o) { setSelectedFile(null); if (fileRef.current) fileRef.current.value = '' } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Employee dropdown */}
            <div className="space-y-1.5">
              <Label>Employee *</Label>
              <EmployeeSelector
                value={uploadMeta.employee_id}
                onChange={(v) => setUploadMeta((p) => ({ ...p, employee_id: typeof v === 'string' ? v : (v[0] ?? '') }))}
                placeholder="Search employee by name or code…"
                className="w-full"
              />
            </div>

            {/* Document type */}
            <div className="space-y-1.5">
              <Label>Document Type *</Label>
              <Select
                value={uploadMeta.doc_type}
                onValueChange={(v) => setUploadMeta((p) => ({ ...p, doc_type: v as DocType }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Expiry */}
            <div className="space-y-1.5">
              <Label>Expiry Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <DateInput
                value={uploadMeta.expires_at}
                onChange={(v) => setUploadMeta((p) => ({ ...p, expires_at: v }))}
              />
            </div>

            {/* File picker */}
            <div className="space-y-1.5">
              <Label>File *</Label>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${selectedFile ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/50'}`}
                onClick={() => fileRef.current?.click()}
              >
                {selectedFile ? (
                  <>
                    <File className="h-6 w-6 text-primary mx-auto mb-2" />
                    <p className="text-sm font-medium">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatBytes(selectedFile.size)} · Click to change</p>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Click to select file</p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG up to 10 MB</p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileChange}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialog(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading || !selectedFile || !uploadMeta.employee_id}>
              {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

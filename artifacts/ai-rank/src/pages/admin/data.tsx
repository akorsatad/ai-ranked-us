import React, { useState } from 'react';
import { useBrowseTable } from '@workspace/api-client-react';

type BrowseTableTable = 'industries' | 'brands' | 'engines' | 'survey_runs' | 'survey_responses';
import { ChevronLeft, ChevronRight, Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

const TABLES: { value: BrowseTableTable; label: string }[] = [
  { value: 'industries', label: 'Industries' },
  { value: 'brands', label: 'Brands' },
  { value: 'engines', label: 'Engines' },
  { value: 'survey_runs', label: 'Survey Runs' },
  { value: 'survey_responses', label: 'Survey Responses' },
];

const STATUS_OPTIONS: Record<string, string[]> = {
  survey_runs: ['running', 'completed', 'failed', 'partial'],
  survey_responses: ['ok', 'failed'],
};

const PAGE_SIZE = 25;

export default function AdminData() {
  const [table, setTable] = useState<BrowseTableTable>('industries');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [runId, setRunId] = useState('');

  const params: Record<string, unknown> = { page, pageSize: PAGE_SIZE };
  if (search.trim()) params.search = search.trim();
  if (status !== 'all' && STATUS_OPTIONS[table]) params.status = status;
  if (table === 'survey_responses' && runId.trim()) params.runId = Number(runId);

  const { data, isLoading } = useBrowseTable(table, params);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const supportsSearch = ['industries', 'brands', 'engines'].includes(table);

  const changeTable = (t: BrowseTableTable) => {
    setTable(t);
    setPage(1);
    setSearch('');
    setStatus('all');
    setRunId('');
  };

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div>
        <h1 className="text-3xl font-sans font-bold tracking-tight">Data Browser</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">Read-only view of the raw database tables.</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={table} onValueChange={(v) => changeTable(v as BrowseTableTable)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TABLES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {supportsSearch && (
          <Input
            placeholder="Search name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-56"
          />
        )}
        {STATUS_OPTIONS[table] && (
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS[table].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {table === 'survey_responses' && (
          <Input
            placeholder="Run ID…"
            value={runId}
            onChange={(e) => { setRunId(e.target.value.replace(/\D/g, '')); setPage(1); }}
            className="w-28 font-mono"
          />
        )}
        {data && (
          <Badge variant="outline" className="font-mono text-xs ml-auto">
            {data.total} rows
          </Badge>
        )}
      </div>

      <Card className="border-border overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading || !data ? (
            <div className="p-6 space-y-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : data.rows.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground font-mono text-sm">No rows.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {data.columns.map((c) => (
                    <TableHead key={c} className="font-mono text-xs uppercase whitespace-nowrap">{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row, i) => (
                  <TableRow key={i}>
                    {data.columns.map((c) => (
                      <TableCell key={c} className="text-sm max-w-[320px] align-top">
                        <CellValue value={(row as Record<string, unknown>)[c]} column={c} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <span className="text-sm font-mono text-muted-foreground">Page {page} of {totalPages}</span>
        <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function CellValue({ value, column }: { value: unknown; column: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/50 font-mono text-xs">—</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <Badge variant="outline" className={`font-mono text-xs ${value ? 'text-accent' : 'text-muted-foreground'}`}>
        {String(value)}
      </Badge>
    );
  }
  if (typeof value === 'object') {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 font-mono text-xs">
            <Braces className="w-3.5 h-3.5" /> JSON
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="font-mono text-sm">{column}</DialogTitle></DialogHeader>
          <pre className="text-xs font-mono bg-muted/50 rounded-md p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap">
            {JSON.stringify(value, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    );
  }
  const text = String(value);
  return <span className="font-mono text-xs break-words">{text.length > 160 ? `${text.slice(0, 160)}…` : text}</span>;
}

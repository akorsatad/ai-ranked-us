import React, { useState, useEffect } from 'react';
import { 
  useBrowseTable, 
  getBrowseTableQueryKey,
  BrowseTableParams,
  useGetAdminCatalog,
  getGetAdminCatalogQueryKey,
  useGetCatalog,
  getGetCatalogQueryKey
} from '@workspace/api-client-react';
import { Database, ChevronLeft, ChevronRight, Code, Table as TableIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminLayout } from './layout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const TABLES = [
  { value: 'industries', label: 'Industries', filters: [] },
  { value: 'brands', label: 'Brands', filters: ['industryId'] },
  { value: 'engines', label: 'Engines', filters: [] },
  { value: 'survey_runs', label: 'Survey Runs', filters: ['status'] },
  { value: 'survey_responses', label: 'Survey Responses', filters: ['industryId', 'engineId', 'runId', 'metric', 'status'] },
] as const;

type TableName = typeof TABLES[number]['value'];
type FilterName = 'industryId' | 'engineId' | 'runId' | 'metric' | 'status';

const RUN_STATUSES = ['running', 'completed', 'failed', 'partial'] as const;

export default function AdminData() {
  const [selectedTable, setSelectedTable] = useState<TableName>('industries');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  
  // Filter state
  const [industryId, setIndustryId] = useState<string>('');
  const [engineId, setEngineId] = useState<string>('');
  const [runId, setRunId] = useState<string>('');
  const [metric, setMetric] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const { data: adminCatalog } = useGetAdminCatalog({
    query: { queryKey: getGetAdminCatalogQueryKey() }
  });

  const { data: catalog } = useGetCatalog({
    query: { queryKey: getGetCatalogQueryKey() }
  });

  // Build params object, only include numeric filters when valid numbers are selected
  const params: BrowseTableParams = { 
    page, 
    pageSize,
    ...(industryId && !isNaN(Number(industryId)) ? { industryId: Number(industryId) } : {}),
    ...(engineId && !isNaN(Number(engineId)) ? { engineId: Number(engineId) } : {}),
    ...(runId && !isNaN(Number(runId)) ? { runId: Number(runId) } : {}),
    ...(metric ? { metric } : {}),
    ...(status ? { status } : {}),
  };

  const { data, isLoading } = useBrowseTable(
    selectedTable,
    params,
    { query: { queryKey: getBrowseTableQueryKey(selectedTable, params) } }
  );

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  const handleTableChange = (table: string) => {
    setSelectedTable(table as TableName);
    setPage(1);
    clearFilters();
  };

  const clearFilters = () => {
    setIndustryId('');
    setEngineId('');
    setRunId('');
    setMetric('');
    setStatus('');
  };

  const handleFilterChange = () => {
    setPage(1);
  };

  useEffect(() => {
    handleFilterChange();
  }, [industryId, engineId, runId, metric, status]);

  const currentTableConfig = TABLES.find(t => t.value === selectedTable);
  const activeFilters = (currentTableConfig?.filters || []) as FilterName[];
  const hasActiveFilters = industryId || engineId || runId || metric || status;

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-6">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">Data Browser</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              Read-only access to raw database tables
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedTable} onValueChange={handleTableChange}>
              <SelectTrigger className="w-[200px] font-mono" data-testid="select-table">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABLES.map(table => (
                  <SelectItem key={table.value} value={table.value}>
                    {table.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {activeFilters.length > 0 && (
          <Card className="border-border bg-muted/20">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                  {activeFilters.includes('industryId') && (
                    <div className="space-y-2">
                      <Label htmlFor="filter-industry" className="text-xs font-mono uppercase text-muted-foreground">Industry</Label>
                      <Select value={industryId} onValueChange={setIndustryId}>
                        <SelectTrigger id="filter-industry" className="font-mono text-sm" data-testid="select-filter-industry">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All Industries</SelectItem>
                          {adminCatalog?.industries.map(ind => (
                            <SelectItem key={ind.id} value={String(ind.id)}>
                              {ind.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {activeFilters.includes('engineId') && (
                    <div className="space-y-2">
                      <Label htmlFor="filter-engine" className="text-xs font-mono uppercase text-muted-foreground">Engine</Label>
                      <Select value={engineId} onValueChange={setEngineId}>
                        <SelectTrigger id="filter-engine" className="font-mono text-sm" data-testid="select-filter-engine">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All Engines</SelectItem>
                          {adminCatalog?.engines.map(eng => (
                            <SelectItem key={eng.id} value={String(eng.id)}>
                              {eng.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {activeFilters.includes('runId') && (
                    <div className="space-y-2">
                      <Label htmlFor="filter-run" className="text-xs font-mono uppercase text-muted-foreground">Run ID</Label>
                      <Select value={runId} onValueChange={setRunId}>
                        <SelectTrigger id="filter-run" className="font-mono text-sm" data-testid="select-filter-run">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All Runs</SelectItem>
                          {/* Note: In a production app, you'd want to fetch recent run IDs from an endpoint */}
                          <SelectItem value="1">Run 1</SelectItem>
                          <SelectItem value="2">Run 2</SelectItem>
                          <SelectItem value="3">Run 3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {activeFilters.includes('metric') && (
                    <div className="space-y-2">
                      <Label htmlFor="filter-metric" className="text-xs font-mono uppercase text-muted-foreground">Metric</Label>
                      <Select value={metric} onValueChange={setMetric}>
                        <SelectTrigger id="filter-metric" className="font-mono text-sm" data-testid="select-filter-metric">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All Metrics</SelectItem>
                          {catalog?.metrics.map(m => (
                            <SelectItem key={m.key} value={m.key}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {activeFilters.includes('status') && (
                    <div className="space-y-2">
                      <Label htmlFor="filter-status" className="text-xs font-mono uppercase text-muted-foreground">Status</Label>
                      <Select value={status} onValueChange={setStatus}>
                        <SelectTrigger id="filter-status" className="font-mono text-sm" data-testid="select-filter-status">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All Statuses</SelectItem>
                          {RUN_STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="capitalize">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {hasActiveFilters && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearFilters}
                    className="gap-2 font-mono flex-shrink-0"
                    data-testid="button-clear-filters"
                  >
                    <X className="w-4 h-4" />
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-border">
          <CardHeader className="bg-muted/30 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle className="font-mono" data-testid="text-current-table">{selectedTable}</CardTitle>
                  <CardDescription>
                    {data ? `${data.total} total rows` : 'Loading...'}
                  </CardDescription>
                </div>
              </div>
              {data && data.total > 0 && (
                <Badge variant="outline" className="font-mono" data-testid="text-row-count">
                  Page {data.page} of {totalPages}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : !data || data.rows.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <TableIcon className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p className="font-medium">No data in this table</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        {Object.keys(data.rows[0]).map(col => (
                          <TableHead key={col} className="font-mono text-xs uppercase whitespace-nowrap" data-testid={`header-${col}`}>
                            {col}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((row, idx) => (
                        <TableRow key={idx} data-testid={`row-${idx}`}>
                          {Object.entries(row).map(([col, value]) => (
                            <TableCell key={col} className="font-mono text-xs" data-testid={`cell-${idx}-${col}`}>
                              <CellValue value={value} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="border-t border-border p-4 flex items-center justify-between bg-muted/10">
                    <p className="text-sm text-muted-foreground font-mono" data-testid="text-pagination-info">
                      Showing {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, data.total)} of {data.total}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="font-mono"
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="font-mono"
                        data-testid="button-next-page"
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

function CellValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-muted-foreground italic">null</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <Badge variant={value ? "default" : "secondary"} className="text-xs">
        {value.toString()}
      </Badge>
    );
  }

  if (typeof value === 'object') {
    return (
      <details className="cursor-pointer">
        <summary className="inline-flex items-center gap-1 text-primary hover:underline">
          <Code className="w-3 h-3" />
          JSON
        </summary>
        <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto max-w-md">
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    );
  }

  const stringValue = String(value);
  const isLongText = stringValue.length > 100;

  if (isLongText) {
    return (
      <details className="cursor-pointer max-w-md">
        <summary className="text-muted-foreground">
          {stringValue.substring(0, 100)}...
        </summary>
        <div className="mt-2 text-xs whitespace-pre-wrap">
          {stringValue}
        </div>
      </details>
    );
  }

  return <span className="whitespace-nowrap">{stringValue}</span>;
}

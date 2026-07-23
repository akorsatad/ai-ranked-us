import React, { useState } from 'react';
import {
  useBrowseTable,
  getBrowseTableQueryKey,
  useCreateIndustry,
  useUpdateIndustry,
  useCreateBrand,
  useUpdateBrand,
  getGetCatalogQueryKey,
  useTriggerRun,
  getListRunsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Pencil, Check, X, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

const LIST_PARAMS = { page: 1, pageSize: 100 };

interface IndustryRowData {
  id: number;
  name: string;
  slug: string;
  country: string;
  enabled: boolean;
}
interface BrandRowData {
  id: number;
  name: string;
  industryId: number;
  enabled: boolean;
}

export default function AdminCatalog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: industriesPage, isLoading: loadingIndustries } = useBrowseTable('industries', LIST_PARAMS);
  const { data: brandsPage, isLoading: loadingBrands } = useBrowseTable('brands', LIST_PARAMS);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getBrowseTableQueryKey('industries', LIST_PARAMS) });
    queryClient.invalidateQueries({ queryKey: getBrowseTableQueryKey('brands', LIST_PARAMS) });
    queryClient.invalidateQueries({ queryKey: getGetCatalogQueryKey() });
  };
  const onError = (e: { message: string }) =>
    toast({ variant: 'destructive', title: 'Operation failed', description: e.message });

  const createIndustry = useCreateIndustry({ mutation: { onSuccess: () => { toast({ title: 'Industry added' }); invalidate(); }, onError } });
  const updateIndustry = useUpdateIndustry({ mutation: { onSuccess: invalidate, onError } });
  const createBrand = useCreateBrand({ mutation: { onSuccess: () => { toast({ title: 'Brand added' }); invalidate(); }, onError } });
  const updateBrand = useUpdateBrand({ mutation: { onSuccess: invalidate, onError } });

  const [newIndustry, setNewIndustry] = useState('');

  const industries = (industriesPage?.rows ?? []) as unknown as IndustryRowData[];
  const brands = (brandsPage?.rows ?? []) as unknown as BrandRowData[];

  return (
    <div className="p-6 md:p-10 max-w-[1100px] space-y-6">
      <div>
        <h1 className="text-3xl font-sans font-bold tracking-tight">Brands & Industries</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          Disabled items are skipped in the next survey run; new items are picked up automatically.
        </p>
      </div>

      <div className="flex items-center gap-2 max-w-md">
        <Input
          placeholder="New industry name…"
          value={newIndustry}
          onChange={(e) => setNewIndustry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newIndustry.trim()) {
              createIndustry.mutate({ data: { name: newIndustry.trim() } });
              setNewIndustry('');
            }
          }}
        />
        <Button
          className="gap-2 shrink-0"
          disabled={!newIndustry.trim() || createIndustry.isPending}
          onClick={() => { createIndustry.mutate({ data: { name: newIndustry.trim() } }); setNewIndustry(''); }}
        >
          <Plus className="w-4 h-4" /> Add Industry
        </Button>
      </div>

      {loadingIndustries || loadingBrands ? (
        <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
      ) : (
        industries.map((industry) => (
          <IndustryCard
            key={industry.id}
            industry={industry}
            brands={brands.filter((b) => b.industryId === industry.id)}
            onToggleIndustry={(enabled) => updateIndustry.mutate({ industryId: industry.id, data: { enabled } })}
            onRenameIndustry={(name) => updateIndustry.mutate({ industryId: industry.id, data: { name } })}
            onAddBrand={(name) => createBrand.mutate({ data: { industryId: industry.id, name } })}
            onToggleBrand={(brandId, enabled) => updateBrand.mutate({ brandId, data: { enabled } })}
            onRenameBrand={(brandId, name) => updateBrand.mutate({ brandId, data: { name } })}
          />
        ))
      )}
    </div>
  );
}

function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button
        className="inline-flex items-center gap-1.5 group"
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Rename"
      >
        <span>{value}</span>
        <Pencil className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 w-48" autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) { onSave(draft.trim()); setEditing(false); }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!draft.trim()}
        onClick={() => { onSave(draft.trim()); setEditing(false); }}>
        <Check className="w-4 h-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(false)}>
        <X className="w-4 h-4" />
      </Button>
    </span>
  );
}

function SurveyIndustryButton({ industry }: { industry: IndustryRowData }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const triggerRun = useTriggerRun({
    mutation: {
      onSuccess: () => {
        toast({
          title: 'Industry Survey Started',
          description: `Surveying ${industry.name} only — results will appear shortly.`,
        });
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
      },
      onError: (error) => {
        toast({
          variant: 'destructive',
          title: 'Survey Failed to Start',
          description: error.message || 'Could not start the industry survey',
        });
      },
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 font-mono"
      disabled={!industry.enabled || triggerRun.isPending}
      onClick={() => triggerRun.mutate({ data: { industryId: industry.id } })}
      data-testid={`button-survey-industry-${industry.id}`}
    >
      {triggerRun.isPending ? (
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Play className="w-3.5 h-3.5" />
      )}
      Survey now
    </Button>
  );
}

function IndustryCard(props: {
  industry: IndustryRowData;
  brands: BrandRowData[];
  onToggleIndustry: (enabled: boolean) => void;
  onRenameIndustry: (name: string) => void;
  onAddBrand: (name: string) => void;
  onToggleBrand: (brandId: number, enabled: boolean) => void;
  onRenameBrand: (brandId: number, name: string) => void;
}) {
  const { industry, brands } = props;
  const [newBrand, setNewBrand] = useState('');
  const addBrand = () => {
    if (!newBrand.trim()) return;
    props.onAddBrand(newBrand.trim());
    setNewBrand('');
  };
  return (
    <Card className={`border-border ${industry.enabled ? '' : 'opacity-60'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="w-4 h-4 text-primary" />
            <InlineEdit value={industry.name} onSave={props.onRenameIndustry} />
            <Badge variant="outline" className="font-mono text-xs">{industry.slug}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <SurveyIndustryButton industry={industry} />
            <span className="text-xs font-mono text-muted-foreground">{industry.enabled ? 'Enabled' : 'Disabled'}</span>
            <Switch checked={industry.enabled} onCheckedChange={props.onToggleIndustry} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {brands.map((brand) => (
            <div
              key={brand.id}
              className={`flex items-center gap-2 border border-border rounded-md px-3 py-1.5 text-sm ${brand.enabled ? 'bg-card' : 'bg-muted/40 opacity-60'}`}
            >
              <InlineEdit value={brand.name} onSave={(name) => props.onRenameBrand(brand.id, name)} />
              <Switch
                checked={brand.enabled}
                onCheckedChange={(enabled) => props.onToggleBrand(brand.id, enabled)}
                className="scale-75"
              />
            </div>
          ))}
          {brands.length === 0 && (
            <span className="text-sm text-muted-foreground font-mono">No brands yet.</span>
          )}
        </div>
        <div className="flex items-center gap-2 max-w-sm">
          <Input
            placeholder="Add brand…"
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addBrand()}
            className="h-8"
          />
          <Button size="sm" variant="outline" className="gap-1 shrink-0" disabled={!newBrand.trim()} onClick={addBrand}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

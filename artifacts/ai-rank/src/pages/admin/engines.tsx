import React, { useState } from 'react';
import { 
  useGetAdminCatalog, 
  getGetAdminCatalogQueryKey,
  getGetCatalogQueryKey,
  useCreateEngine,
  useUpdateEngine,
  AdminEngine,
  AdminEngineProvider
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Power, PowerOff, Cpu, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminLayout } from './layout';

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'openrouter'] as const;

export default function AdminEngines() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: catalog, isLoading } = useGetAdminCatalog({
    query: { queryKey: getGetAdminCatalogQueryKey() }
  });

  const engines = catalog?.engines || [];

  const filteredEngines = searchQuery
    ? engines.filter(e => 
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.vendor.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.key.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : engines;

  const invalidateCatalog = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminCatalogQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCatalogQueryKey() });
  };

  const enabledCount = engines.filter(e => e.enabled).length;

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-6">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">AI Engine Configuration</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              Configure models, providers, and survey participation
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm font-mono text-muted-foreground" data-testid="text-engine-count">
              {enabledCount} / {engines.length} active
            </div>
            <CreateEngineDialog onSuccess={invalidateCatalog} />
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search engines by name, vendor, model, or key..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 font-mono"
            data-testid="input-search-engines"
          />
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : filteredEngines.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Cpu className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">No engines found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredEngines.map(engine => (
              <EngineCard key={engine.id} engine={engine} onUpdate={invalidateCatalog} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function EngineCard({ engine, onUpdate }: { engine: AdminEngine, onUpdate: () => void }) {
  const providerColors: Record<string, string> = {
    openai: 'bg-green-500/10 text-green-600 border-green-500/20',
    anthropic: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    gemini: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    openrouter: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  };

  return (
    <Card 
      className={`border-border ${!engine.enabled ? 'opacity-60' : ''}`}
      data-testid={`card-engine-${engine.id}`}
    >
      <CardHeader className="bg-muted/20 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="bg-primary/10 text-primary p-2 rounded-lg flex-shrink-0">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-lg truncate" data-testid={`text-engine-name-${engine.id}`}>{engine.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge 
                  variant="outline" 
                  className={`text-xs font-mono ${providerColors[engine.provider] || 'bg-secondary'}`}
                  data-testid={`badge-provider-${engine.id}`}
                >
                  {engine.provider}
                </Badge>
                <Badge 
                  variant={engine.enabled ? "default" : "secondary"} 
                  className="font-mono text-xs"
                  data-testid={`badge-engine-status-${engine.id}`}
                >
                  {engine.enabled ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </div>
          </div>
          <EditEngineDialog engine={engine} onSuccess={onUpdate} />
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground font-medium mb-1">Key</p>
            <p className="font-mono text-xs bg-muted/50 px-2 py-1 rounded truncate" data-testid={`text-engine-key-${engine.id}`}>
              {engine.key}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground font-medium mb-1">Vendor</p>
            <p className="font-medium truncate" data-testid={`text-engine-vendor-${engine.id}`}>{engine.vendor}</p>
          </div>
        </div>
        <div>
          <p className="text-muted-foreground font-medium mb-1 text-sm">Model</p>
          <p className="font-mono text-sm bg-muted/50 px-2 py-1 rounded truncate" data-testid={`text-engine-model-${engine.id}`}>
            {engine.model}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateEngineDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('');
  const [provider, setProvider] = useState<AdminEngineProvider>('openai');
  const [model, setModel] = useState('');
  const { toast } = useToast();

  const createEngine = useCreateEngine({
    mutation: {
      onSuccess: () => {
        toast({ title: "Engine Created", description: `${name} has been added.` });
        setOpen(false);
        setKey('');
        setName('');
        setVendor('');
        setProvider('openai');
        setModel('');
        onSuccess();
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Creation Failed", description: error.message });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !name.trim() || !vendor.trim() || !model.trim()) return;
    createEngine.mutate({ 
      data: { 
        key: key.trim(), 
        name: name.trim(), 
        vendor: vendor.trim(), 
        provider, 
        model: model.trim() 
      } 
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-mono" data-testid="button-create-engine">
          <Plus className="w-4 h-4" /> New Engine
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add AI Engine</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="engine-key">Engine Key</Label>
            <Input 
              id="engine-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. gpt4o"
              className="font-mono"
              data-testid="input-engine-key"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="engine-name">Display Name</Label>
            <Input 
              id="engine-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GPT-4o"
              data-testid="input-engine-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="engine-vendor">Vendor</Label>
            <Input 
              id="engine-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. OpenAI"
              data-testid="input-engine-vendor"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="engine-provider">Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as AdminEngineProvider)}>
              <SelectTrigger id="engine-provider" data-testid="select-engine-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="engine-model">Model String</Label>
            <Input 
              id="engine-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gpt-4o-2024-08-06"
              className="font-mono"
              data-testid="input-engine-model"
            />
          </div>
          <DialogFooter>
            <Button 
              type="submit" 
              disabled={!key.trim() || !name.trim() || !vendor.trim() || !model.trim() || createEngine.isPending}
              data-testid="button-submit-engine"
            >
              {createEngine.isPending ? 'Creating...' : 'Create Engine'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditEngineDialog({ engine, onSuccess }: { engine: AdminEngine, onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(engine.name);
  const [vendor, setVendor] = useState(engine.vendor);
  const [model, setModel] = useState(engine.model);
  const { toast } = useToast();

  const updateEngine = useUpdateEngine({
    mutation: {
      onSuccess: () => {
        toast({ title: "Engine Updated" });
        setOpen(false);
        onSuccess();
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !vendor.trim() || !model.trim()) return;
    updateEngine.mutate({ 
      engineId: engine.id, 
      data: { name: name.trim(), vendor: vendor.trim(), model: model.trim() } 
    });
  };

  const toggleEnabled = () => {
    updateEngine.mutate({ engineId: engine.id, data: { enabled: !engine.enabled } });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`button-edit-engine-${engine.id}`}>
          <Edit2 className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Engine</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-engine-name">Display Name</Label>
            <Input 
              id="edit-engine-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-edit-engine-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-engine-vendor">Vendor</Label>
            <Input 
              id="edit-engine-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              data-testid="input-edit-engine-vendor"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-engine-model">Model String</Label>
            <Input 
              id="edit-engine-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="font-mono"
              data-testid="input-edit-engine-model"
            />
          </div>
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div>
              <p className="font-medium">Survey Participation</p>
              <p className="text-sm text-muted-foreground">
                {engine.enabled ? 'Included in runs' : 'Excluded from runs'}
              </p>
            </div>
            <Button 
              type="button"
              variant={engine.enabled ? "default" : "secondary"}
              size="sm"
              onClick={toggleEnabled}
              className="gap-2"
              data-testid={`button-toggle-status-engine-${engine.id}`}
            >
              {engine.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
              {engine.enabled ? 'Active' : 'Inactive'}
            </Button>
          </div>
          <DialogFooter>
            <Button 
              type="submit" 
              disabled={!name.trim() || !vendor.trim() || !model.trim() || updateEngine.isPending}
              data-testid="button-submit-edit-engine"
            >
              {updateEngine.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

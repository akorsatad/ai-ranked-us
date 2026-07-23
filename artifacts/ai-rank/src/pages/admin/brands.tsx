import React, { useState } from 'react';
import { 
  useGetAdminCatalog, 
  getGetAdminCatalogQueryKey,
  getGetCatalogQueryKey,
  useCreateIndustry,
  useUpdateIndustry,
  useCreateBrand,
  useUpdateBrand,
  Industry,
  Brand
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Power, PowerOff, Building2, Tag, Search, ChevronDown, ChevronRight } from 'lucide-react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export default function AdminBrands() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: catalog, isLoading } = useGetAdminCatalog({
    query: { queryKey: getGetAdminCatalogQueryKey() }
  });

  const industries = catalog?.industries || [];
  const brands = catalog?.brands || [];

  const filteredIndustries = searchQuery
    ? industries.filter(i => 
        i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        brands.filter(b => b.industryId === i.id).some(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : industries;

  const invalidateCatalog = () => {
    queryClient.invalidateQueries({ queryKey: getGetAdminCatalogQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCatalogQueryKey() });
  };

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-6">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">Industry & Brand Catalog</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              Manage sectors and brands surveyed by AI engines
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CreateIndustryDialog onSuccess={invalidateCatalog} />
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search industries or brands..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 font-mono"
            data-testid="input-search"
          />
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : filteredIndustries.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">No industries found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredIndustries.map(industry => (
              <IndustryCard 
                key={industry.id} 
                industry={industry} 
                brands={brands.filter(b => b.industryId === industry.id)}
                onUpdate={invalidateCatalog}
              />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function IndustryCard({ industry, brands, onUpdate }: { industry: Industry, brands: Brand[], onUpdate: () => void }) {
  const [isOpen, setIsOpen] = useState(true);
  const enabledCount = brands.filter(b => b.enabled).length;

  return (
    <Card className={`border-border ${!industry.enabled ? 'opacity-60' : ''}`} data-testid={`card-industry-${industry.id}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="bg-muted/20 border-b border-border">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger className="flex items-center gap-3 flex-1 cursor-pointer hover:opacity-80 transition-opacity" data-testid={`button-toggle-industry-${industry.id}`}>
              <div className="h-6 w-6 flex items-center justify-center">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
              <Building2 className="w-5 h-5 text-primary" />
              <div className="text-left">
                <CardTitle className="text-lg" data-testid={`text-industry-name-${industry.id}`}>{industry.name}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-mono text-muted-foreground uppercase">{industry.country}</span>
                  <Badge variant="outline" className="text-xs font-mono" data-testid={`badge-brand-count-${industry.id}`}>
                    {enabledCount} / {brands.length} brands
                  </Badge>
                </div>
              </div>
            </CollapsibleTrigger>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge 
                variant={industry.enabled ? "default" : "secondary"} 
                className="font-mono text-xs"
                data-testid={`badge-industry-status-${industry.id}`}
              >
                {industry.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <EditIndustryDialog industry={industry} onSuccess={onUpdate} />
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground font-medium">Brands in this industry</p>
              <CreateBrandDialog industryId={industry.id} onSuccess={onUpdate} />
            </div>
            
            {brands.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                <Tag className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No brands yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {brands.map(brand => (
                  <BrandCard key={brand.id} brand={brand} onUpdate={onUpdate} />
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function BrandCard({ brand, onUpdate }: { brand: Brand, onUpdate: () => void }) {
  return (
    <div 
      className={`flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted/20 transition-colors ${!brand.enabled ? 'opacity-60' : ''}`}
      data-testid={`card-brand-${brand.id}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="font-medium truncate" data-testid={`text-brand-name-${brand.id}`}>{brand.name}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge 
          variant={brand.enabled ? "default" : "secondary"} 
          className="text-xs font-mono"
          data-testid={`badge-brand-status-${brand.id}`}
        >
          {brand.enabled ? 'On' : 'Off'}
        </Badge>
        <EditBrandDialog brand={brand} onUpdate={onUpdate} />
      </div>
    </div>
  );
}

function CreateIndustryDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('US');
  const { toast } = useToast();

  const createIndustry = useCreateIndustry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Industry Created", description: `${name} has been added to the catalog.` });
        setOpen(false);
        setName('');
        setCountry('US');
        onSuccess();
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Creation Failed", description: error.message });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createIndustry.mutate({ data: { name: name.trim(), country } });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-mono" data-testid="button-create-industry">
          <Plus className="w-4 h-4" /> New Industry
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Industry</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="industry-name">Industry Name</Label>
            <Input 
              id="industry-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fast Food"
              data-testid="input-industry-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="industry-country">Country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger id="industry-country" data-testid="select-industry-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="US">United States</SelectItem>
                <SelectItem value="UK">United Kingdom</SelectItem>
                <SelectItem value="CA">Canada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || createIndustry.isPending} data-testid="button-submit-industry">
              {createIndustry.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditIndustryDialog({ industry, onSuccess }: { industry: Industry, onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(industry.name);
  const { toast } = useToast();

  const updateIndustry = useUpdateIndustry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Industry Updated" });
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
    if (!name.trim()) return;
    updateIndustry.mutate({ industryId: industry.id, data: { name: name.trim() } });
  };

  const toggleEnabled = () => {
    updateIndustry.mutate({ industryId: industry.id, data: { enabled: !industry.enabled } });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`button-edit-industry-${industry.id}`}>
          <Edit2 className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Industry</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-industry-name">Industry Name</Label>
            <Input 
              id="edit-industry-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-edit-industry-name"
            />
          </div>
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div>
              <p className="font-medium">Status</p>
              <p className="text-sm text-muted-foreground">
                {industry.enabled ? 'Include in surveys' : 'Exclude from surveys'}
              </p>
            </div>
            <Button 
              type="button"
              variant={industry.enabled ? "default" : "secondary"}
              size="sm"
              onClick={toggleEnabled}
              className="gap-2"
              data-testid={`button-toggle-status-industry-${industry.id}`}
            >
              {industry.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
              {industry.enabled ? 'Enabled' : 'Disabled'}
            </Button>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || updateIndustry.isPending} data-testid="button-submit-edit-industry">
              {updateIndustry.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateBrandDialog({ industryId, onSuccess }: { industryId: number, onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const { toast } = useToast();

  const createBrand = useCreateBrand({
    mutation: {
      onSuccess: () => {
        toast({ title: "Brand Created", description: `${name} added successfully.` });
        setOpen(false);
        setName('');
        onSuccess();
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Creation Failed", description: error.message });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createBrand.mutate({ data: { industryId, name: name.trim() } });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 font-mono" data-testid={`button-create-brand-${industryId}`}>
          <Plus className="w-3 h-3" /> Add Brand
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Brand</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Brand Name</Label>
            <Input 
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. McDonald's"
              data-testid="input-brand-name"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || createBrand.isPending} data-testid="button-submit-brand">
              {createBrand.isPending ? 'Adding...' : 'Add Brand'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditBrandDialog({ brand, onUpdate }: { brand: Brand, onUpdate: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(brand.name);
  const { toast } = useToast();

  const updateBrand = useUpdateBrand({
    mutation: {
      onSuccess: () => {
        toast({ title: "Brand Updated" });
        setOpen(false);
        onUpdate();
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    updateBrand.mutate({ brandId: brand.id, data: { name: name.trim() } });
  };

  const toggleEnabled = () => {
    updateBrand.mutate({ brandId: brand.id, data: { enabled: !brand.enabled } });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`button-edit-brand-${brand.id}`}>
          <Edit2 className="w-3 h-3" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Brand</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-brand-name">Brand Name</Label>
            <Input 
              id="edit-brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-edit-brand-name"
            />
          </div>
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div>
              <p className="font-medium">Status</p>
              <p className="text-sm text-muted-foreground">
                {brand.enabled ? 'Active in surveys' : 'Excluded from surveys'}
              </p>
            </div>
            <Button 
              type="button"
              variant={brand.enabled ? "default" : "secondary"}
              size="sm"
              onClick={toggleEnabled}
              className="gap-2"
              data-testid={`button-toggle-status-brand-${brand.id}`}
            >
              {brand.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
              {brand.enabled ? 'Enabled' : 'Disabled'}
            </Button>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || updateBrand.isPending} data-testid="button-submit-edit-brand">
              {updateBrand.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

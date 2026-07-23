import React, { useState } from 'react';
import { 
  useListApiKeys, 
  getListApiKeysQueryKey,
  useSetApiKey,
  ApiKeyStatus
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Key, Eye, EyeOff, AlertCircle, CheckCircle2, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminLayout } from './layout';

export default function AdminApiKeys() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: keys, isLoading } = useListApiKeys({
    query: { queryKey: getListApiKeysQueryKey() }
  });

  const invalidateKeys = () => {
    queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
  };

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-[1200px] mx-auto space-y-6">
        
        <div>
          <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">API Key Management</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            Configure provider credentials for survey execution
          </p>
        </div>

        <Alert className="bg-primary/5 border-primary/20">
          <AlertCircle className="h-5 w-5 !text-primary" />
          <AlertDescription className="text-sm">
            Keys are stored securely and never exposed in full. <span className="font-mono">env</span> indicates the built-in Replit AI key is in use. Set a custom key to override.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="space-y-4">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : !keys || keys.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Key className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="font-medium">No API keys configured</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {keys.map(keyStatus => (
              <ApiKeyCard key={keyStatus.provider} keyStatus={keyStatus} onUpdate={invalidateKeys} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function ApiKeyCard({ keyStatus, onUpdate }: { keyStatus: ApiKeyStatus, onUpdate: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const { toast } = useToast();

  const setApiKeyMutation = useSetApiKey({
    mutation: {
      onSuccess: () => {
        toast({ 
          title: "Key Updated", 
          description: apiKey.trim() ? "Custom key saved successfully." : "Custom key cleared, using environment default."
        });
        setIsEditing(false);
        setApiKey('');
        setShowKey(false);
        onUpdate();
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
      }
    }
  });

  const handleSave = () => {
    setApiKeyMutation.mutate({ provider: keyStatus.provider, data: { apiKey: apiKey.trim() } });
  };

  const handleClear = () => {
    if (!confirm('Clear custom key and revert to environment default?')) return;
    setApiKeyMutation.mutate({ provider: keyStatus.provider, data: { apiKey: '' } });
  };

  const sourceColors: Record<string, string> = {
    stored: 'bg-accent/10 text-accent-foreground border-accent/20',
    env: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    none: 'bg-muted text-muted-foreground border-muted',
  };

  const sourceLabels: Record<string, string> = {
    stored: 'Custom Key',
    env: 'Environment',
    none: 'Not Configured',
  };

  return (
    <Card className="border-border" data-testid={`card-api-key-${keyStatus.provider}`}>
      <CardHeader className="bg-muted/20 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary p-2 rounded-lg">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg capitalize" data-testid={`text-provider-${keyStatus.provider}`}>{keyStatus.provider}</CardTitle>
              <CardDescription className="font-mono text-xs uppercase tracking-wider">
                AI Provider
              </CardDescription>
            </div>
          </div>
          <Badge 
            variant="outline" 
            className={`font-mono text-xs ${sourceColors[keyStatus.source]}`}
            data-testid={`badge-source-${keyStatus.provider}`}
          >
            {sourceLabels[keyStatus.source]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {!isEditing ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground mb-2">Current Key</p>
                {keyStatus.maskedKey ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-accent" />
                    <span className="font-mono text-sm" data-testid={`text-masked-key-${keyStatus.provider}`}>
                      ••••••••••••{keyStatus.maskedKey}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {keyStatus.source === 'env' ? 'Using Replit AI integration' : 'No key configured'}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsEditing(true)}
                  className="font-mono"
                  data-testid={`button-edit-key-${keyStatus.provider}`}
                >
                  Set Custom Key
                </Button>
                {keyStatus.source === 'stored' && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleClear}
                    className="text-destructive hover:text-destructive"
                    data-testid={`button-clear-key-${keyStatus.provider}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`key-${keyStatus.provider}`}>API Key</Label>
              <div className="relative">
                <Input 
                  id={`key-${keyStatus.provider}`}
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                  className="font-mono pr-10"
                  data-testid={`input-api-key-${keyStatus.provider}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowKey(!showKey)}
                  data-testid={`button-toggle-visibility-${keyStatus.provider}`}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave empty and save to clear custom key and use environment default
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                onClick={handleSave}
                disabled={setApiKeyMutation.isPending}
                className="gap-2 font-mono"
                data-testid={`button-save-key-${keyStatus.provider}`}
              >
                <Save className="w-4 h-4" />
                {setApiKeyMutation.isPending ? 'Saving...' : 'Save Key'}
              </Button>
              <Button 
                variant="ghost"
                onClick={() => {
                  setIsEditing(false);
                  setApiKey('');
                  setShowKey(false);
                }}
                data-testid={`button-cancel-key-${keyStatus.provider}`}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

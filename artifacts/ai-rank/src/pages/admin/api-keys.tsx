import React, { useState } from 'react';
import {
  useListApiKeys,
  getListApiKeysQueryKey,
  useSetApiKey,
  useDeleteApiKey,
  ProviderKeyStatus,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
};

export default function AdminApiKeys() {
  const { data: keys, isLoading } = useListApiKeys();

  return (
    <div className="p-6 md:p-10 max-w-[900px] space-y-6">
      <div>
        <h1 className="text-3xl font-sans font-bold tracking-tight">API Keys</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          Per-provider keys used to call AI engines. Stored keys take precedence over environment keys.
        </p>
      </div>
      {isLoading || !keys ? (
        <div className="space-y-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : (
        keys.map((k) => <ProviderCard key={k.provider} status={k} />)
      )}
    </div>
  );
}

function ProviderCard({ status }: { status: ProviderKeyStatus }) {
  const [value, setValue] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });

  const setKey = useSetApiKey({
    mutation: {
      onSuccess: () => {
        setValue('');
        toast({ title: `${PROVIDER_LABELS[status.provider]} key saved` });
        invalidate();
      },
      onError: (e) =>
        toast({ variant: 'destructive', title: 'Failed to save key', description: e.message }),
    },
  });
  const deleteKey = useDeleteApiKey({
    mutation: {
      onSuccess: () => {
        toast({ title: `${PROVIDER_LABELS[status.provider]} key removed` });
        invalidate();
      },
      onError: (e) =>
        toast({ variant: 'destructive', title: 'Failed to remove key', description: e.message }),
    },
  });

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="w-4 h-4 text-primary" />
            {PROVIDER_LABELS[status.provider] ?? status.provider}
          </CardTitle>
          <div className="flex items-center gap-2">
            {status.hasStoredKey ? (
              <Badge className="font-mono text-xs bg-accent/10 text-accent border-accent/20" variant="outline">
                Stored key: {status.maskedKey}
              </Badge>
            ) : (
              <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                No stored key
              </Badge>
            )}
            <Badge variant="outline" className="font-mono text-xs">
              {status.hasEnvKey ? 'Env fallback available' : 'No env key'}
            </Badge>
          </div>
        </div>
        <CardDescription className="font-mono text-xs">
          {status.hasStoredKey
            ? `Updated ${status.updatedAt ? new Date(status.updatedAt).toLocaleString() : ''} — engines use this key.`
            : status.hasEnvKey
              ? 'Engines currently use the environment/integration key.'
              : 'No key configured — engine calls for this provider will fail.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2 flex-wrap">
        <Input
          type="password"
          placeholder={status.hasStoredKey ? 'Replace stored key…' : 'Paste API key…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="max-w-md font-mono"
        />
        <Button
          onClick={() => setKey.mutate({ provider: status.provider, data: { key: value.trim() } })}
          disabled={value.trim().length < 8 || setKey.isPending}
          className="gap-2"
        >
          <Save className="w-4 h-4" /> Save
        </Button>
        {status.hasStoredKey && (
          <Button
            variant="outline"
            onClick={() => deleteKey.mutate({ provider: status.provider })}
            disabled={deleteKey.isPending}
            className="gap-2 text-destructive"
          >
            <Trash2 className="w-4 h-4" /> Remove
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

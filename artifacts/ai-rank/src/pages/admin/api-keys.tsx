import React, { useState } from 'react';
import {
  useListApiKeys,
  getListApiKeysQueryKey,
  useSetApiKey,
  useDeleteApiKey,
  useTestApiKey,
  useGetKeyPreflightSettings,
  getGetKeyPreflightSettingsQueryKey,
  useUpdateKeyPreflightSettings,
  ProviderKeyStatus,
  ApiKeyTestResult,
  KeyPreflightSettingsMode,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2, Save, FlaskConical, CheckCircle2, XCircle, Loader2, ShieldAlert } from 'lucide-react';
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
      <PreflightModeCard />
      {isLoading || !keys ? (
        <div className="space-y-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : (
        keys.map((k) => <ProviderCard key={k.provider} status={k} />)
      )}
    </div>
  );
}

function PreflightModeCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetKeyPreflightSettings();

  const update = useUpdateKeyPreflightSettings({
    mutation: {
      onSuccess: (settings) => {
        queryClient.invalidateQueries({ queryKey: getGetKeyPreflightSettingsQueryKey() });
        toast({
          title:
            settings.mode === 'block'
              ? 'Runs will be blocked when a key check fails'
              : 'Runs will start with a warning when a key check fails',
        });
      },
      onError: (e) =>
        toast({ variant: 'destructive', title: 'Failed to update setting', description: e.message }),
    },
  });

  const mode = data?.mode;
  const setMode = (m: KeyPreflightSettingsMode) => {
    if (m !== mode) update.mutate({ data: { mode: m } });
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldAlert className="w-4 h-4 text-primary" />
          Pre-flight key check
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          Before every survey run, each provider used by an enabled engine is verified with a minimal test call.
          Choose what happens if a key fails.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2 flex-wrap">
        {isLoading || !mode ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <>
            <Button
              variant={mode === 'warn' ? 'default' : 'outline'}
              onClick={() => setMode('warn')}
              disabled={update.isPending}
              className="gap-2 font-mono"
              data-testid="button-preflight-warn"
            >
              Warn but start the run
            </Button>
            <Button
              variant={mode === 'block' ? 'default' : 'outline'}
              onClick={() => setMode('block')}
              disabled={update.isPending}
              className="gap-2 font-mono"
              data-testid="button-preflight-block"
            >
              Refuse to start the run
            </Button>
            {update.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderCard({ status }: { status: ProviderKeyStatus }) {
  const [value, setValue] = useState('');
  const [testResult, setTestResult] = useState<ApiKeyTestResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });

  const setKey = useSetApiKey({
    mutation: {
      onSuccess: () => {
        setValue('');
        setTestResult(null);
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
        setTestResult(null);
        toast({ title: `${PROVIDER_LABELS[status.provider]} key removed` });
        invalidate();
      },
      onError: (e) =>
        toast({ variant: 'destructive', title: 'Failed to remove key', description: e.message }),
    },
  });

  const testKey = useTestApiKey({
    mutation: {
      onSuccess: (result) => setTestResult(result),
      onError: (e) =>
        setTestResult({
          provider: status.provider,
          ok: false,
          source: status.hasStoredKey ? 'stored' : 'env',
          error: e.message,
        }),
    },
  });
  const canTest = status.hasStoredKey || status.hasEnvKey;

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
        {canTest && (
          <Button
            variant="outline"
            onClick={() => {
              setTestResult(null);
              testKey.mutate({ provider: status.provider });
            }}
            disabled={testKey.isPending}
            className="gap-2"
          >
            {testKey.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FlaskConical className="w-4 h-4" />
            )}
            {testKey.isPending ? 'Testing…' : 'Test key'}
          </Button>
        )}
        {testResult && !testKey.isPending && (
          <div
            className={`flex items-start gap-2 font-mono text-xs w-full mt-1 ${
              testResult.ok ? 'text-accent' : 'text-destructive'
            }`}
          >
            {testResult.ok ? (
              <>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Key works ({testResult.source === 'stored' ? 'stored key' : 'environment key'})
                </span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 shrink-0" />
                <span className="break-all">
                  Invalid key ({testResult.source === 'stored' ? 'stored key' : 'environment key'})
                  {testResult.error ? ` — ${testResult.error}` : ''}
                </span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

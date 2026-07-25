import React, { useState, useEffect, useMemo } from 'react';
import {
  useGetPromptTemplate,
  getGetPromptTemplateQueryKey,
  useUpdatePromptTemplate,
  useResetPromptTemplate,
  PromptTemplateKind,
  PromptPlaceholder,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, Eye, AlertTriangle, Braces, CalendarDays, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

function renderPreview(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match,
  );
}

const KIND_META: Record<string, { title: string; blurb: string; icon: React.ReactNode }> = {
  current: {
    title: 'Daily ranking prompt',
    blurb: "Asks for today's snapshot ranking only — the engine is told not to reason about history.",
    icon: <CalendarDays className="w-5 h-5 text-sky-600" />,
  },
  trend: {
    title: '13-week trend prompt',
    blurb: 'Asks for the 13-week trajectory only — the engine is told to assess movement independently, not anchor to a current ranking.',
    icon: <TrendingUp className="w-5 h-5 text-violet-600" />,
  },
};

export default function AdminQueries() {
  const { data: info, isLoading } = useGetPromptTemplate({
    query: { queryKey: getGetPromptTemplateQueryKey() },
  });

  return (
    <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">Survey Queries</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          Each survey makes two isolated engine calls per brand set — a daily
          ranking and a 13-week trend — so neither answer anchors the other.
          Edit each prompt below.
        </p>
      </div>

      {isLoading || !info ? (
        <div className="space-y-4">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          {info.templates.map((t) => (
            <TemplateEditor
              key={t.kind}
              info={t}
              placeholders={info.placeholders}
              exampleValues={info.exampleValues}
            />
          ))}

          <Card className="border-border">
            <CardHeader className="bg-muted/30 border-b border-border">
              <div className="flex items-center gap-3">
                <Braces className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle>Placeholders</CardTitle>
                  <CardDescription>Tokens replaced with real values for each query</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {info.placeholders.map((p) => (
                  <div key={p.name} className="p-4 flex items-start justify-between gap-4" data-testid={`row-placeholder-${p.name}`}>
                    <div>
                      <code className="font-mono text-sm text-primary">{`{{${p.name}}}`}</code>
                      <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                    </div>
                    <Badge variant={p.required ? 'default' : 'secondary'} className="font-mono text-xs">
                      {p.required ? 'required' : 'optional'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function TemplateEditor({
  info,
  placeholders,
  exampleValues,
}: {
  info: PromptTemplateKind;
  placeholders: PromptPlaceholder[];
  exampleValues: Record<string, string>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const meta = KIND_META[info.kind] ?? KIND_META.current!;

  const [draft, setDraft] = useState<string | null>(null);
  // Reset the local draft whenever the server template for this kind changes.
  useEffect(() => {
    setDraft(null);
  }, [info.template]);

  const template = draft ?? info.template;
  const isDirty = template !== info.template;

  const missingRequired = useMemo(
    () =>
      placeholders
        .filter((p) => p.required && !template.includes(`{{${p.name}}}`))
        .map((p) => p.name),
    [placeholders, template],
  );
  const preview = useMemo(
    () => renderPreview(template, exampleValues),
    [template, exampleValues],
  );

  const onSuccess = (title: string, description: string) => {
    queryClient.invalidateQueries({ queryKey: getGetPromptTemplateQueryKey() });
    setDraft(null);
    toast({ title, description });
  };

  const update = useUpdatePromptTemplate({
    mutation: {
      onSuccess: () => onSuccess('Template saved', 'Takes effect on the next survey run.'),
      onError: (e) => toast({ variant: 'destructive', title: 'Save failed', description: e.message }),
    },
  });
  const reset = useResetPromptTemplate({
    mutation: {
      onSuccess: () => onSuccess('Template reset', 'Restored the built-in default.'),
      onError: (e) => toast({ variant: 'destructive', title: 'Reset failed', description: e.message }),
    },
  });

  return (
    <Card className="border-border">
      <CardHeader className="bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {meta.icon}
            <div>
              <CardTitle className="flex items-center gap-2">
                {meta.title}
                {info.isCustom ? (
                  <Badge variant="outline" className="font-mono text-[10px] uppercase" data-testid={`badge-custom-${info.kind}`}>Custom</Badge>
                ) : (
                  <Badge variant="secondary" className="font-mono text-[10px] uppercase" data-testid={`badge-default-${info.kind}`}>Default</Badge>
                )}
              </CardTitle>
              <CardDescription>{meta.blurb}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="space-y-3">
          <Textarea
            value={template}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            className="font-mono text-xs leading-relaxed"
            data-testid={`textarea-template-${info.kind}`}
          />
          {missingRequired.length > 0 && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md border border-destructive/20 font-mono">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Missing required placeholders: {missingRequired.map((m) => `{{${m}}}`).join(', ')}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => update.mutate({ data: { kind: info.kind, template } })}
              disabled={!isDirty || missingRequired.length > 0 || update.isPending}
              className="gap-2 font-mono"
              data-testid={`button-save-${info.kind}`}
            >
              <Save className="w-4 h-4" /> Save
            </Button>
            <Button
              variant="outline"
              onClick={() => reset.mutate({ params: { kind: info.kind } })}
              disabled={(!info.isCustom && !isDirty) || reset.isPending}
              className="gap-2 font-mono"
              data-testid={`button-reset-${info.kind}`}
            >
              <RotateCcw className="w-4 h-4" /> Reset to default
            </Button>
            {isDirty && <span className="text-xs font-mono text-muted-foreground">Unsaved changes</span>}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase text-muted-foreground">
            <Eye className="w-3.5 h-3.5" /> Live preview
          </div>
          <pre
            className="text-xs font-mono whitespace-pre-wrap bg-muted/40 p-4 rounded-md border border-border leading-relaxed max-h-[360px] overflow-y-auto"
            data-testid={`text-preview-${info.kind}`}
          >
            {preview}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import {
  useGetPromptTemplate,
  getGetPromptTemplateQueryKey,
  useUpdatePromptTemplate,
  useResetPromptTemplate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, RotateCcw, Save, Eye, AlertTriangle, Braces } from 'lucide-react';
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

export default function AdminQueries() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: info, isLoading } = useGetPromptTemplate({
    query: { queryKey: getGetPromptTemplateQueryKey() },
  });

  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (info && draft === null) setDraft(info.template);
  }, [info, draft]);

  const template = draft ?? info?.template ?? '';
  const isDirty = info ? template !== info.template : false;

  const missingRequired = useMemo(() => {
    if (!info) return [];
    return info.placeholders
      .filter((p) => p.required && !template.includes(`{{${p.name}}}`))
      .map((p) => p.name);
  }, [info, template]);

  const preview = useMemo(
    () => (info ? renderPreview(template, info.exampleValues) : ''),
    [info, template],
  );

  const onMutationSuccess = (title: string, description: string) => {
    queryClient.invalidateQueries({ queryKey: getGetPromptTemplateQueryKey() });
    setDraft(null);
    toast({ title, description });
  };

  const updateTemplate = useUpdatePromptTemplate({
    mutation: {
      onSuccess: () =>
        onMutationSuccess('Template Saved', 'The new prompt template takes effect on the next survey run.'),
      onError: (error) =>
        toast({
          variant: 'destructive',
          title: 'Save Failed',
          description: error.message || 'Could not save the template',
        }),
    },
  });

  const resetTemplate = useResetPromptTemplate({
    mutation: {
      onSuccess: () =>
        onMutationSuccess('Template Reset', 'Restored the built-in default prompt template.'),
      onError: (error) =>
        toast({
          variant: 'destructive',
          title: 'Reset Failed',
          description: error.message || 'Could not reset the template',
        }),
    },
  });

  return (

      <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">Survey Queries</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              Edit the prompt template sent to every AI engine
            </p>
          </div>
          <div className="flex items-center gap-2">
            {info?.isCustom && (
              <Badge variant="outline" className="font-mono text-xs uppercase" data-testid="badge-custom-template">
                Custom template
              </Badge>
            )}
            {!info?.isCustom && info && (
              <Badge variant="secondary" className="font-mono text-xs uppercase" data-testid="badge-default-template">
                Default template
              </Badge>
            )}
          </div>
        </div>

        {isLoading || !info ? (
          <div className="space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <div className="space-y-6">
              <Card className="border-border">
                <CardHeader className="bg-muted/30 border-b border-border">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-primary" />
                    <div>
                      <CardTitle>Prompt Template</CardTitle>
                      <CardDescription>
                        Changes apply to the next survey run. Placeholders are replaced per engine query.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  <Textarea
                    value={template}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={18}
                    className="font-mono text-xs leading-relaxed"
                    data-testid="textarea-template"
                  />
                  {missingRequired.length > 0 && (
                    <div
                      className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md border border-destructive/20 font-mono"
                      data-testid="text-missing-placeholders"
                    >
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        Missing required placeholders:{' '}
                        {missingRequired.map((m) => `{{${m}}}`).join(', ')}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => updateTemplate.mutate({ data: { template } })}
                      disabled={!isDirty || missingRequired.length > 0 || updateTemplate.isPending}
                      className="gap-2 font-mono"
                      data-testid="button-save-template"
                    >
                      <Save className="w-4 h-4" />
                      Save Template
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => resetTemplate.mutate()}
                      disabled={(!info.isCustom && !isDirty) || resetTemplate.isPending}
                      className="gap-2 font-mono"
                      data-testid="button-reset-template"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reset to Default
                    </Button>
                    {isDirty && (
                      <span className="text-xs font-mono text-muted-foreground">Unsaved changes</span>
                    )}
                  </div>
                </CardContent>
              </Card>

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
            </div>

            <Card className="border-border">
              <CardHeader className="bg-muted/30 border-b border-border">
                <div className="flex items-center gap-3">
                  <Eye className="w-5 h-5 text-primary" />
                  <div>
                    <CardTitle>Live Preview</CardTitle>
                    <CardDescription>
                      Example rendering with sample metric and brands
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <pre
                  className="text-xs font-mono whitespace-pre-wrap bg-muted/40 p-4 rounded-md border border-border leading-relaxed"
                  data-testid="text-preview"
                >
                  {preview}
                </pre>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

  );
}

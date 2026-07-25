import React, { useState } from 'react';
import {
  useListAdmins,
  getListAdminsQueryKey,
  useInviteAdmin,
  useRemoveAdmin,
  AdminAccount,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserPlus, Trash2, Loader2, MailQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AdminAdmins() {
  const { data, isLoading } = useListAdmins();

  return (
    <div className="p-6 md:p-10 max-w-[800px] space-y-6">
      <div>
        <h1 className="text-3xl font-sans font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-primary" />
          Admins
        </h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          Accounts with access to this console. Invites are claimed
          automatically when the invited email first signs in and opens the
          admin area.
        </p>
      </div>

      <InviteCard />

      {isLoading || !data ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {data.admins.map((admin) => (
            <AdminRow key={admin.id} admin={admin} />
          ))}
        </div>
      )}
    </div>
  );
}

function InviteCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');

  const invite = useInviteAdmin({
    mutation: {
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: getListAdminsQueryKey() });
        setEmail('');
        toast({ title: `Invite created for ${created.email}` });
      },
      onError: (e) =>
        toast({
          variant: 'destructive',
          title: 'Failed to invite',
          description: e.message,
        }),
    },
  });

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserPlus className="w-4 h-4 text-primary" />
          Invite an admin
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          They sign in with this email (via the admin sign-in page) and get
          access automatically — no manual claiming step.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = email.trim();
            if (trimmed) invite.mutate({ data: { email: trimmed } });
          }}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            aria-label="Email to invite"
            data-testid="input-invite-email"
          />
          <Button
            type="submit"
            disabled={invite.isPending || !email.trim()}
            className="gap-2"
            data-testid="button-invite-admin"
          >
            {invite.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            Invite
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AdminRow({ admin }: { admin: AdminAccount }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const remove = useRemoveAdmin({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminsQueryKey() });
        toast({
          title: admin.pending ? 'Invite revoked' : 'Admin removed',
        });
      },
      onError: (e) =>
        toast({
          variant: 'destructive',
          title: 'Failed to remove',
          description: e.message,
        }),
    },
  });

  return (
    <Card className="border-border" data-testid={`card-admin-${admin.id}`}>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3 min-w-0">
          {admin.pending ? (
            <MailQuestion className="w-5 h-5 text-muted-foreground shrink-0" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-medium truncate">
              {admin.email ?? 'Unknown email'}
              {admin.self && (
                <span className="ml-2 text-xs text-muted-foreground font-mono">
                  (you)
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              {admin.pending ? 'Invited' : 'Admin since'}{' '}
              {formatDate(String(admin.createdAt))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {admin.pending ? (
            <Badge variant="outline">Pending invite</Badge>
          ) : (
            <Badge variant="secondary">Active</Badge>
          )}
          {!admin.self && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  disabled={remove.isPending}
                  aria-label={
                    admin.pending ? 'Revoke invite' : 'Remove admin'
                  }
                  data-testid={`button-remove-admin-${admin.id}`}
                >
                  {remove.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {admin.pending ? 'Revoke this invite?' : 'Remove this admin?'}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {admin.pending
                      ? `${admin.email ?? 'This email'} will no longer be able to claim admin access.`
                      : `${admin.email ?? 'This account'} will immediately lose access to the admin console.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => remove.mutate({ adminId: admin.id })}
                  >
                    {admin.pending ? 'Revoke invite' : 'Remove admin'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

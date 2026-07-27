import React, { useState } from 'react';
import {
  useListAdminUsers,
  getListAdminUsersQueryKey,
  useUpdateUserStatus,
  AdminAppUser,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Search,
  Ban,
  RotateCcw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Power,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 25;

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AdminUsers() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading } = useListAdminUsers({
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { search } : {}),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="p-6 md:p-10 max-w-[1100px] space-y-6">
      <div>
        <h1 className="text-3xl font-sans font-bold tracking-tight flex items-center gap-2">
          <Users className="w-7 h-7 text-primary" />
          Users
        </h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          Public accounts created through magic-link sign-in. Disabling an
          account revokes its sessions immediately.
        </p>
      </div>

      <form
        className="flex gap-2 max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search email or name…"
          aria-label="Search users"
          data-testid="input-user-search"
        />
        <Button type="submit" variant="outline" className="gap-2">
          <Search className="w-4 h-4" />
          Search
        </Button>
      </form>

      <Card className="border-border">
        <CardContent className="p-0">
          {isLoading || !data ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : data.users.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground font-mono">
              {search ? 'No users match this search.' : 'No users yet.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((user) => (
                  <UserRow key={user.id} user={user} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground font-mono">
            Page {page} of {totalPages} · {data.total} users
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({ user }: { user: AdminAppUser }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const update = useUpdateUserStatus({
    mutation: {
      onSuccess: (updated) => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        toast({
          title: updated.disabled
            ? `${updated.email} disabled`
            : `${updated.email} re-enabled`,
        });
      },
      onError: (e) =>
        toast({
          variant: 'destructive',
          title: 'Failed to update user',
          description: e.message,
        }),
    },
  });

  const activate = useUpdateUserStatus({
    mutation: {
      onSuccess: (updated) => {
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
        toast({
          title: updated.activated
            ? `${updated.email} activated for paid features`
            : `${updated.email} returned to beta`,
        });
      },
      onError: (e) =>
        toast({
          variant: 'destructive',
          title: 'Failed to update access',
          description: e.message,
        }),
    },
  });

  return (
    <TableRow data-testid={`row-user-${user.id}`}>
      <TableCell>
        <div className="font-medium">{user.email}</div>
        <div className="text-xs text-muted-foreground">
          {user.firstName} {user.lastName}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Badge variant={user.tier === 'free' ? 'outline' : 'default'} className="capitalize">
            {user.tier}
          </Badge>
          {user.subscriptionStatus && user.subscriptionStatus !== 'active' && (
            <span className="text-[10px] font-mono uppercase text-muted-foreground">
              {user.subscriptionStatus}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-xs">
        {user.tokenBalance.toLocaleString()}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {formatDate(String(user.createdAt))}
      </TableCell>
      <TableCell className="text-right font-mono">{user.rankRequests}</TableCell>
      <TableCell className="font-mono text-xs">
        {formatDate(user.lastRequestAt ? String(user.lastRequestAt) : null)}
      </TableCell>
      <TableCell className="text-right font-mono">{user.activeSessions}</TableCell>
      <TableCell>
        {user.activated ? (
          <Badge variant="default">Activated</Badge>
        ) : (
          <Badge variant="outline">Beta</Badge>
        )}
      </TableCell>
      <TableCell>
        {user.disabled ? (
          <Badge variant="destructive">Disabled</Badge>
        ) : (
          <Badge variant="secondary">Active</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          <Button
            variant={user.activated ? 'ghost' : 'default'}
            size="sm"
            className="gap-1.5"
            disabled={activate.isPending}
            onClick={() =>
              activate.mutate({ userId: user.id, data: { activated: !user.activated } })
            }
            data-testid={`button-activate-user-${user.id}`}
          >
            {activate.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : user.activated ? (
              <Power className="w-3.5 h-3.5" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            {user.activated ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            variant={user.disabled ? 'outline' : 'ghost'}
            size="sm"
            className="gap-1.5"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ userId: user.id, data: { disabled: !user.disabled } })
            }
            data-testid={`button-toggle-user-${user.id}`}
          >
            {update.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : user.disabled ? (
              <RotateCcw className="w-3.5 h-3.5" />
            ) : (
              <Ban className="w-3.5 h-3.5" />
            )}
            {user.disabled ? 'Enable' : 'Disable'}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

import React, { useState } from 'react';
import { useRequestMagicLink } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, X, CheckCircle } from 'lucide-react';

interface AuthModalProps {
  onClose: () => void;
  title?: string;
  description?: string;
}

export function AuthModal({ onClose, title = 'Sign in to continue', description = 'Enter your details below and we\'ll send you a sign-in link.' }: AuthModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const { mutate: requestLink, isPending, error } = useRequestMagicLink({
    mutation: {
      onSuccess: () => setSent(true),
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    requestLink({ data: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() } });
  }

  const errorMessage = error
    ? ((error as { data?: { message?: string } }).data?.message ?? 'Something went wrong. Please try again.')
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {sent ? (
          <div className="text-center py-4">
            <div className="flex justify-center mb-4">
              <div className="bg-primary/10 rounded-full p-4">
                <CheckCircle className="w-10 h-10 text-primary" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Check your inbox</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We sent a sign-in link to <span className="text-foreground font-medium">{email}</span>.
              Click it to continue — it expires in 15&nbsp;minutes.
            </p>
            <Button variant="outline" className="mt-6 w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 rounded-xl p-2.5">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">{title}</h2>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="auth-first-name" className="text-xs font-medium">First name</Label>
                  <Input
                    id="auth-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Alex"
                    required
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-last-name" className="text-xs font-medium">Last name</Label>
                  <Input
                    id="auth-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Smith"
                    required
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="auth-email" className="text-xs font-medium">Email address</Label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-9 text-sm"
                />
              </div>

              {errorMessage && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  {errorMessage}
                </p>
              )}

              <Button
                type="submit"
                disabled={isPending || !firstName.trim() || !lastName.trim() || !email.trim()}
                className="w-full"
              >
                {isPending ? 'Sending…' : 'Send sign-in link'}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                No password needed — we'll email you a one-click link.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

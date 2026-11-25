"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Mail,
  User,
  Lock,
  Shield,
  ArrowRight,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { api, formatApiError } from "@/lib/api";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("super_admin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/admin/users", {
        email,
        password,
        name,
        role,
      });
      setCreated(true);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  if (created) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">Admin Created ✅</CardTitle>
            <CardDescription>
              Your temporary admin account has been created successfully.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-blue-800">Admin Credentials</h3>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-blue-600">Email:</span>
                  <span className="font-mono">{email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-600">Password:</span>
                  <span className="font-mono">{password}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-600">Role:</span>
                  <span>{role}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-600">Name:</span>
                  <span>{name}</span>
                </div>
              </div>
              <p className="text-xs text-blue-700 mt-2">
                Save these credentials now. They won't be shown again.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                asChild
                className="w-full"
              >
                <Link href="/login">Go to Login</Link>
              </Button>
              <Button variant="outline" onClick={() => setCreated(false)}>
                Create Another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3 mb-4">
              <Flame className="h-8 w-8 text-orange-600" />
              <h1 className="text-2xl font-bold tracking-tight">Ojchat Admin</h1>
            </div>
            <p className="text-muted-foreground">
              Admin panel for the Ojchat dating platform. Create a temporary
              administrator account to get started.
            </p>
          </CardHeader>

          <ErrorBanner error={error} />

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@ojchat.app"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="System Admin"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">
                  Must be at least 8 characters.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="moderator">Moderator</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
              >
                {loading ? "Creating..." : "Create Admin Account"}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="flex justify-between items-center pt-6">
            <Button variant="outline" asChild className="w-auto">
              <Link href="/login">Already have an account? Login</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>

      <footer className="mt-8 text-xs text-muted-foreground">
        Ojchat Admin • Create temporary admin access
      </footer>
    </div>
  );
}

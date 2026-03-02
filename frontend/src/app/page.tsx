import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <h1 className="text-xl font-bold">AI Marketing Platform</h1>
          <nav className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link href="/register">
              <Button>Get Started</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="max-w-3xl text-center">
          <h2 className="text-5xl font-bold tracking-tight">
            AI-Powered Social Media
            <br />
            <span className="text-primary/70">Marketing Made Simple</span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground">
            Configure your business once. Let AI generate engaging social media
            posts. Review, edit, and publish to Facebook & Instagram with one
            click.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="text-lg px-8">
                Start Free Trial
              </Button>
            </Link>
            <Link href="#features">
              <Button size="lg" variant="outline" className="text-lg px-8">
                Learn More
              </Button>
            </Link>
          </div>
        </div>

        <section id="features" className="mt-24 w-full max-w-5xl">
          <h3 className="text-center text-3xl font-bold">How It Works</h3>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="rounded-lg border p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                1
              </div>
              <h4 className="text-lg font-semibold">Configure Your Brand</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                Set up your business name, niche, tone, and brand voice once.
              </p>
            </div>
            <div className="rounded-lg border p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                2
              </div>
              <h4 className="text-lg font-semibold">Generate with AI</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                AI creates engaging posts tailored to your brand and audience.
              </p>
            </div>
            <div className="rounded-lg border p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                3
              </div>
              <h4 className="text-lg font-semibold">Review & Publish</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                Edit if needed, then publish directly to your social platforms.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>AI Marketing Platform. Built for small businesses.</p>
      </footer>
    </div>
  );
}

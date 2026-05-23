import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Privacy Policy — AI Marketing Platform",
  description:
    "How AI Marketing Platform collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-bold"
          >
            <Image
              src="/omni_logo.png"
              alt="AI Marketing logo"
              width={32}
              height={32}
              priority
            />
            AI Marketing Platform
          </Link>
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

      <main className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: May 19, 2026
        </p>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Overview</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            AI Marketing Platform (&ldquo;we&rdquo;, &ldquo;our&rdquo;, the
            &ldquo;Service&rdquo;) helps small businesses plan, generate, and
            publish marketing content across social networks. This page
            explains what information we collect, how we use it, and the
            controls you have over your data.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Information we collect</h2>
          <ul className="list-disc space-y-2 pl-6 text-sm leading-6 text-muted-foreground">
            <li>
              <strong>Account information</strong> — your name, email address,
              and authentication credentials when you register or sign in.
            </li>
            <li>
              <strong>Brand information you provide</strong> — business name,
              niche, target audience, website URL, brand voice, hashtags, and
              other content you enter into the Brand Kit.
            </li>
            <li>
              <strong>Social account connections</strong> — when you connect
              Facebook, Instagram, LinkedIn, X (Twitter), YouTube, Reddit,
              Threads, or Dev.to, we store the access tokens and account
              identifiers needed to publish on your behalf. We do not store
              your social-network passwords.
            </li>
            <li>
              <strong>Generated content</strong> — posters, reels, blog posts,
              SEO briefs, and captions you generate using the Service, plus
              the AI prompts used to produce them.
            </li>
            <li>
              <strong>Usage data</strong> — pages visited, features used,
              credit consumption, and error logs to help us operate and
              improve the Service.
            </li>
          </ul>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">
            Facebook and Instagram permissions
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            When you connect Facebook or Instagram, we request the minimum
            permissions needed to publish content on your behalf:
          </p>
          <ul className="list-disc space-y-2 pl-6 text-sm leading-6 text-muted-foreground">
            <li>
              <code>pages_show_list</code>, <code>pages_read_engagement</code>,{" "}
              <code>pages_manage_posts</code>,{" "}
              <code>pages_manage_metadata</code> — to list the Facebook Pages
              you manage and publish posts you have authored within the
              Service.
            </li>
            <li>
              <code>instagram_basic</code>,{" "}
              <code>instagram_content_publish</code> — to identify the
              Instagram Business account linked to your Page and publish
              reels and posts you have created.
            </li>
            <li>
              <code>business_management</code> — to access the Business
              portfolio that owns the connected Pages and Instagram accounts.
            </li>
          </ul>
          <p className="text-sm leading-6 text-muted-foreground">
            We only act on content you explicitly create and publish within
            the Service. We do not post, like, follow, message, or read other
            users&apos; content on your behalf.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">How we use information</h2>
          <ul className="list-disc space-y-2 pl-6 text-sm leading-6 text-muted-foreground">
            <li>To provide the core features of the Service.</li>
            <li>
              To publish content you create to the social networks you
              connect, at the times you schedule.
            </li>
            <li>To bill you and manage credits and subscription state.</li>
            <li>
              To improve the Service&apos;s performance, reliability, and
              quality of generated content.
            </li>
            <li>To respond to support requests.</li>
          </ul>
          <p className="text-sm leading-6 text-muted-foreground">
            We do not sell your personal data, and we do not use your
            content or social-account data to train third-party advertising
            models.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Data retention</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            We retain your account information and generated content for as
            long as your account is active. Access tokens for connected
            social accounts are kept only until you disconnect the account or
            the token is revoked by the network. You can request deletion of
            your account and all associated data at any time using the
            contact below.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Your controls</h2>
          <ul className="list-disc space-y-2 pl-6 text-sm leading-6 text-muted-foreground">
            <li>
              <strong>Disconnect any social account</strong> at any time from
              Settings &rarr; Integrations.
            </li>
            <li>
              <strong>Delete your account</strong> from Settings &rarr;
              Danger Zone. This removes your profile, brand kit, and
              generated content from our systems.
            </li>
            <li>
              <strong>Revoke Facebook/Instagram permissions</strong> directly
              at{" "}
              <a
                href="https://www.facebook.com/settings?tab=business_tools"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                facebook.com/settings &rarr; Business Integrations
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Security</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            We encrypt data in transit using TLS and store access tokens in a
            managed database with restricted access. No system is perfectly
            secure, so we encourage you to use a strong, unique password and
            to revoke access promptly if you suspect a compromise.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Children</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            The Service is not directed to children under 13 and we do not
            knowingly collect data from them.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Changes to this policy</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            We may update this Privacy Policy from time to time. Material
            changes will be highlighted on this page with a revised
            &ldquo;Last updated&rdquo; date.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Questions, deletion requests, or data-access requests can be sent
            to{" "}
            <a
              href="mailto:appreview.fleetcore@gmail.com"
              className="text-primary underline"
            >
              appreview.fleetcore@gmail.com
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="mt-auto border-t">
        <div className="container mx-auto flex h-14 items-center justify-between px-4 text-xs text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} AI Marketing Platform</span>
          <nav className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

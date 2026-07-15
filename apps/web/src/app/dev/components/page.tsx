"use client";

/**
 * Dev-only showcase for the vendored registry components (Magic UI + Kibo UI).
 * Visual verification surface — not linked from any nav. Safe to extend as
 * more components are vendored. See .claude/skills/polytoken-design-system/.
 */

import { useRef } from "react";

import { AnimatedBeam } from "@polytoken/ui/animated-beam";
import { AnimatedList } from "@polytoken/ui/animated-list";
import { Avatar, AvatarFallback } from "@polytoken/ui/avatar";
import { AvatarStack } from "@polytoken/ui/avatar-stack";
import { BlurFade } from "@polytoken/ui/blur-fade";
import { BorderBeam } from "@polytoken/ui/border-beam";
import { ConfettiButton } from "@polytoken/ui/confetti";
import { DotPattern } from "@polytoken/ui/dot-pattern";
import { MagicCard } from "@polytoken/ui/magic-card";
import { Marquee } from "@polytoken/ui/marquee";
import { NumberTicker } from "@polytoken/ui/number-ticker";
import { Rating, RatingButton } from "@polytoken/ui/rating";
import { ShimmerButton } from "@polytoken/ui/shimmer-button";
import { ShineBorder } from "@polytoken/ui/shine-border";
import { Spinner } from "@polytoken/ui/spinner";
import { TypingAnimation } from "@polytoken/ui/typing-animation";

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section
    data-section={title}
    className="rounded-lg border border-border bg-card p-4"
  >
    <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
    {children}
  </section>
);

const DevComponentsPage = () => {
  const beamContainerRef = useRef<HTMLDivElement>(null);
  const beamFromRef = useRef<HTMLDivElement>(null);
  const beamToRef = useRef<HTMLDivElement>(null);

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-8 md:grid-cols-2">
      <h1 className="text-lg font-semibold md:col-span-2">
        Vendored component showcase
      </h1>

      <Section title="marquee">
        <Marquee className="[--duration:12s]" data-testid="marquee">
          {["polytoken", "knowledge", "canvas", "genui", "email"].map((word) => (
            <span
              key={word}
              className="mx-2 rounded-full bg-secondary px-3 py-1 text-sm"
            >
              {word}
            </span>
          ))}
        </Marquee>
      </Section>

      <Section title="border-beam">
        <div className="relative h-24 overflow-hidden rounded-xl border border-border p-4">
          <span className="text-sm">panel with traveling border beam</span>
          <BorderBeam size={60} duration={5} />
        </div>
      </Section>

      <Section title="shine-border">
        <div className="relative h-24 rounded-xl p-4">
          <ShineBorder shineColor={["#2b6e5f", "#9c40ff"]} />
          <span className="text-sm">panel with animated shine border</span>
        </div>
      </Section>

      <Section title="shimmer-button">
        <ShimmerButton background="hsl(164 39% 22%)">
          <span className="text-sm">shimmer</span>
        </ShimmerButton>
      </Section>

      <Section title="number-ticker">
        <NumberTicker
          value={1234}
          className="text-3xl font-semibold"
          data-testid="ticker"
        />
      </Section>

      <Section title="typing-animation">
        <TypingAnimation className="text-base" duration={40}>
          Streaming text affordance for chat panels.
        </TypingAnimation>
      </Section>

      <Section title="blur-fade">
        <BlurFade delay={0.2}>
          <p className="text-sm">This paragraph blur-fades in.</p>
        </BlurFade>
      </Section>

      <Section title="animated-list">
        <AnimatedList delay={800} className="gap-2">
          {["edge promoted", "entity linked", "email ingested"].map((item) => (
            <div
              key={item}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {item}
            </div>
          ))}
        </AnimatedList>
      </Section>

      <Section title="dot-pattern">
        <div className="relative h-24 overflow-hidden rounded-xl border border-border">
          <DotPattern className="opacity-60" />
        </div>
      </Section>

      <Section title="magic-card">
        <MagicCard className="rounded-xl p-6">
          <span className="text-sm">hover for spotlight</span>
        </MagicCard>
      </Section>

      <Section title="animated-beam">
        <div
          ref={beamContainerRef}
          className="relative flex h-24 items-center justify-between px-8"
        >
          <div
            ref={beamFromRef}
            className="z-10 rounded-full border border-border bg-background p-3 text-xs"
          >
            A
          </div>
          <div
            ref={beamToRef}
            className="z-10 rounded-full border border-border bg-background p-3 text-xs"
          >
            B
          </div>
          <AnimatedBeam
            containerRef={beamContainerRef}
            fromRef={beamFromRef}
            toRef={beamToRef}
          />
        </div>
      </Section>

      <Section title="confetti-button">
        <ConfettiButton className="rounded-md border border-border px-4 py-2 text-sm">
          celebrate
        </ConfettiButton>
      </Section>

      <Section title="spinner">
        <Spinner className="size-6 text-primary" />
      </Section>

      <Section title="avatar-stack">
        <AvatarStack>
          {["PS", "NA", "KG"].map((initials) => (
            <Avatar key={initials}>
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          ))}
        </AvatarStack>
      </Section>

      <Section title="rating (@kibo-ui, STCK-04 registry-install proof)">
        <Rating defaultValue={3} data-testid="rating">
          {Array.from({ length: 5 }, (_, i) => (
            <RatingButton key={i} />
          ))}
        </Rating>
      </Section>
    </main>
  );
};

export default DevComponentsPage;

"use client";

import { useMemo, useState } from "react";

import { Button } from "@nauta/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nauta/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@nauta/ui/popover";

import { api } from "~/trpc/react";

import { ModelPickerEntry, type ChatModelEntry } from "./model-picker-entry";

export interface ModelPickerProps {
  readonly conversationId: string;
  readonly currentModelId: string;
  /**
   * Called instead of the default chat.setModel persist when the user picks
   * a browser-locus (WebLLM) entry — the 22-11 download/WebGPU-readiness
   * gate hooks in here. Falls back to the same server-model flow when
   * omitted (today): the browser entry's real capabilities/cost/best-for
   * still render honestly (D-05), it just persists immediately like any
   * other selection until 22-11 adds the loading gate in front of it.
   */
  readonly onSelectBrowserModel?: (modelId: string) => void;
}

const TRANSPORT_GROUPS: ReadonlyArray<{
  readonly transport: ChatModelEntry["transport"];
  readonly heading: string;
}> = [
  { transport: "bedrock", heading: "Bedrock" },
  { transport: "openrouter", heading: "OpenRouter" },
  { transport: "browser", heading: "Browser" },
];

/**
 * ModelPicker (D-04..D-10) — toolbar trigger showing the current model's
 * short name; opens a cmdk Command grouped Bedrock / OpenRouter / Browser
 * (22-UI-SPEC.md Interaction Contracts). Selecting a server model persists
 * it via chat.setModel and invalidates listConversations (so the parent's
 * selectedConversation.modelId — which feeds useChatStream.send — updates);
 * selecting a browser model defers to onSelectBrowserModel (22-11 seam).
 */
export function ModelPicker({
  conversationId,
  currentModelId,
  onSelectBrowserModel,
}: ModelPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const utils = api.useUtils();
  const { data } = api.chat.models.useQuery();
  const setModel = api.chat.setModel.useMutation({
    onSuccess: async () => {
      await utils.chat.listConversations.invalidate();
    },
  });

  const models = data?.models ?? [];

  const currentModel = useMemo(
    () => models.find((model) => model.id === currentModelId) ?? null,
    [models, currentModelId],
  );

  const handleSelect = (model: ChatModelEntry): void => {
    setOpen(false);
    if (model.executionLocus === "browser" && onSelectBrowserModel) {
      onSelectBrowserModel(model.id);
      return;
    }
    if (model.id === currentModelId) return;
    setModel.mutate({ conversationId, modelId: model.id });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-w-48 justify-start truncate"
        >
          {currentModel?.displayName ?? currentModelId}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] p-0">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList>
            <CommandEmpty>No models available.</CommandEmpty>
            {TRANSPORT_GROUPS.map(({ transport, heading }) => {
              const entries = models.filter(
                (model) => model.transport === transport,
              );
              if (entries.length === 0) return null;
              return (
                <CommandGroup key={transport} heading={heading}>
                  {entries.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={`${model.displayName} ${model.id}`}
                      onSelect={() => handleSelect(model)}
                    >
                      <ModelPickerEntry
                        model={model}
                        isRecommended={model.id === currentModelId}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

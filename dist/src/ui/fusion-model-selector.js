import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { CURRENT_MODEL_SELECTION, defaultFusionModelConfig } from '../core/fusion/config.js';
export const FUSION_MODEL_SLOT_IDS = [
    'candidate-1',
    'candidate-2',
    'candidate-3',
    'evaluator',
    'merger',
];
function slotLabel(id) {
    if (id === 'candidate-1')
        return 'Candidate 1';
    if (id === 'candidate-2')
        return 'Candidate 2';
    if (id === 'candidate-3')
        return 'Candidate 3';
    if (id === 'evaluator')
        return 'Evaluator';
    return 'Merger';
}
function configValue(config, id) {
    if (id === 'candidate-1')
        return config.candidates[0];
    if (id === 'candidate-2')
        return config.candidates[1];
    if (id === 'candidate-3')
        return config.candidates[2];
    if (id === 'evaluator')
        return config.evaluator;
    return config.merger;
}
function updateConfig(config, id, value) {
    if (id === 'candidate-1')
        return { ...config, candidates: [value, config.candidates[1], config.candidates[2]] };
    if (id === 'candidate-2')
        return { ...config, candidates: [config.candidates[0], value, config.candidates[2]] };
    if (id === 'candidate-3')
        return { ...config, candidates: [config.candidates[0], config.candidates[1], value] };
    if (id === 'evaluator')
        return { ...config, evaluator: value };
    return { ...config, merger: value };
}
function queryMatches(choice, query) {
    if (query.length === 0)
        return true;
    const haystack = `${choice.label} ${choice.description} ${choice.value}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
}
function printable(data) {
    if (data.length !== 1)
        return undefined;
    const code = data.charCodeAt(0);
    if (code < 32 || code === 127)
        return undefined;
    return data;
}
function modelChoiceLine(choice) {
    const status = choice.available ? '' : ' (unavailable)';
    return `${choice.label}${status}${choice.description ? ` — ${choice.description}` : ''}`;
}
function slotViews(config) {
    return FUSION_MODEL_SLOT_IDS.map((id) => ({
        id,
        label: slotLabel(id),
        value: configValue(config, id),
    }));
}
export class FusionModelSelector {
    choices;
    theme;
    onSave;
    onDone;
    onRenderRequest;
    draft;
    mode = 'slots';
    selectedSlot = 0;
    selectedChoice = 0;
    search = '';
    saving = false;
    error;
    cachedWidth;
    cachedLines;
    constructor(options) {
        this.draft = options.initialConfig;
        this.choices = options.choices;
        this.theme = options.theme;
        this.onSave = options.onSave;
        this.onDone = options.onDone;
        this.onRenderRequest = options.onRenderRequest;
    }
    render(width) {
        if (this.cachedWidth === width && this.cachedLines !== undefined)
            return this.cachedLines;
        const lines = this.mode === 'slots' ? this.renderSlots(width) : this.renderChoices(width);
        this.cachedWidth = width;
        this.cachedLines = lines.map((line) => truncateToWidth(line, Math.max(1, width)));
        return this.cachedLines;
    }
    handleInput(data) {
        if (this.saving)
            return;
        if (this.mode === 'slots')
            this.handleSlotInput(data);
        else
            this.handleChoiceInput(data);
    }
    invalidate() {
        this.cachedWidth = undefined;
        this.cachedLines = undefined;
    }
    renderSlots(width) {
        const slots = slotViews(this.draft);
        const lines = [
            this.theme.fg('accent', this.theme.bold('Fusion models')),
            this.theme.fg('dim', 'Select five slots. Duplicate models are allowed.'),
            '',
        ];
        for (const [index, slot] of slots.entries()) {
            const marker = index === this.selectedSlot ? this.theme.fg('accent', '›') : ' ';
            const value = this.describeSelection(slot.value);
            lines.push(`${marker} ${slot.label.padEnd(12)} ${value}`);
        }
        lines.push('');
        if (this.error !== undefined)
            lines.push(this.theme.fg('error', this.error));
        const saveText = this.saving ? 'saving…' : 's save';
        lines.push(this.theme.fg('dim', `↑↓ slot • enter choose • r reset • ${saveText} • esc cancel`));
        return lines.map((line) => truncateToWidth(line, width));
    }
    renderChoices(width) {
        const selectedSlot = FUSION_MODEL_SLOT_IDS[this.selectedSlot];
        const title = selectedSlot === undefined ? 'Choose model' : `Choose model for ${slotLabel(selectedSlot)}`;
        const filtered = this.filteredChoices();
        const lines = [
            this.theme.fg('accent', this.theme.bold(title)),
            `${this.theme.fg('dim', 'Search:')} ${this.search || this.theme.fg('dim', '(type to filter)')}`,
            '',
        ];
        if (filtered.length === 0) {
            lines.push(this.theme.fg('warning', 'No matching models.'));
        }
        else {
            const windowStart = Math.max(0, Math.min(this.selectedChoice - 6, Math.max(0, filtered.length - 12)));
            const windowItems = filtered.slice(windowStart, windowStart + 12);
            for (const [offset, choice] of windowItems.entries()) {
                const index = windowStart + offset;
                const marker = index === this.selectedChoice ? this.theme.fg('accent', '›') : ' ';
                const label = choice.available ? choice.label : this.theme.fg('warning', choice.label);
                const description = choice.description
                    ? this.theme.fg('dim', ` — ${choice.description}`)
                    : '';
                const stale = choice.available ? '' : this.theme.fg('warning', ' (unavailable)');
                lines.push(`${marker} ${label}${stale}${description}`);
            }
            if (filtered.length > windowItems.length) {
                lines.push(this.theme.fg('dim', `${String(windowStart + 1)}-${String(windowStart + windowItems.length)} of ${String(filtered.length)}`));
            }
        }
        lines.push('');
        lines.push(this.theme.fg('dim', '↑↓ choose • enter apply • backspace edit search • esc back'));
        return lines.map((line) => truncateToWidth(line, width));
    }
    handleSlotInput(data) {
        if (matchesKey(data, Key.up)) {
            this.selectedSlot = Math.max(0, this.selectedSlot - 1);
            this.changed();
            return;
        }
        if (matchesKey(data, Key.down)) {
            this.selectedSlot = Math.min(FUSION_MODEL_SLOT_IDS.length - 1, this.selectedSlot + 1);
            this.changed();
            return;
        }
        if (matchesKey(data, Key.enter) || data === '\r') {
            this.mode = 'models';
            this.search = '';
            this.selectedChoice = this.selectedChoiceForCurrentSlot();
            this.changed();
            return;
        }
        if (data === 'r') {
            this.draft = defaultFusionModelConfig();
            this.error = undefined;
            this.changed();
            return;
        }
        if (data === 's') {
            void this.save();
            return;
        }
        if (matchesKey(data, Key.escape) || data === 'q') {
            this.onDone({ type: 'cancelled' });
        }
    }
    handleChoiceInput(data) {
        const filtered = this.filteredChoices();
        if (matchesKey(data, Key.up)) {
            this.selectedChoice = Math.max(0, this.selectedChoice - 1);
            this.changed();
            return;
        }
        if (matchesKey(data, Key.down)) {
            this.selectedChoice = Math.min(Math.max(0, filtered.length - 1), this.selectedChoice + 1);
            this.changed();
            return;
        }
        if (matchesKey(data, Key.enter) || data === '\r') {
            const choice = filtered[this.selectedChoice];
            const slot = FUSION_MODEL_SLOT_IDS[this.selectedSlot];
            if (choice !== undefined && slot !== undefined) {
                this.draft = updateConfig(this.draft, slot, choice.value);
                this.mode = 'slots';
                this.error = undefined;
            }
            this.changed();
            return;
        }
        if (matchesKey(data, Key.escape)) {
            this.mode = 'slots';
            this.changed();
            return;
        }
        if (matchesKey(data, Key.backspace) || data === '\x7f') {
            this.search = this.search.slice(0, -1);
            this.selectedChoice = 0;
            this.changed();
            return;
        }
        const char = printable(data);
        if (char !== undefined) {
            this.search += char;
            this.selectedChoice = 0;
            this.changed();
        }
    }
    async save() {
        this.saving = true;
        this.error = undefined;
        this.changed();
        try {
            await this.onSave(this.draft);
            this.onDone({ type: 'saved', config: this.draft });
        }
        catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.saving = false;
            this.changed();
        }
    }
    changed() {
        this.invalidate();
        this.onRenderRequest?.();
    }
    filteredChoices() {
        return this.choices.filter((choice) => queryMatches(choice, this.search));
    }
    selectedChoiceForCurrentSlot() {
        const slot = FUSION_MODEL_SLOT_IDS[this.selectedSlot];
        if (slot === undefined)
            return 0;
        const current = configValue(this.draft, slot);
        const filtered = this.filteredChoices();
        const index = filtered.findIndex((choice) => choice.value === current);
        return index >= 0 ? index : 0;
    }
    describeSelection(value) {
        if (value === CURRENT_MODEL_SELECTION) {
            const current = this.choices.find((choice) => choice.value === CURRENT_MODEL_SELECTION);
            return current === undefined ? CURRENT_MODEL_SELECTION : modelChoiceLine(current);
        }
        const found = this.choices.find((choice) => choice.value === value);
        if (found === undefined)
            return `${value} (unavailable)`;
        return modelChoiceLine(found);
    }
}
//# sourceMappingURL=fusion-model-selector.js.map
/** A shuffled round visits every eligible track once. Looking ahead for tags
 * does not consume a track; only playback advances the queue. */
export class ShuffleOrder {
  private eligible: number[] = [];
  private remaining: number[] = [];
  private history: number[] = [];
  private cursor = -1;

  private mix(tracks: number[]): number[] {
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
    return tracks;
  }

  private sync(eligible: readonly number[]): void {
    if (eligible.length === this.eligible.length && eligible.every((v, i) => v === this.eligible[i])) return;
    const added = eligible.filter(i => !this.eligible.includes(i) && i !== this.history[this.cursor]);
    this.remaining = this.remaining.filter(i => eligible.includes(i));
    if (this.remaining.length && added.length) this.remaining = this.mix([...this.remaining, ...added]);
    this.eligible = [...eligible];
  }

  private adjacent(direction: number): number {
    for (let at = this.cursor + direction; at >= 0 && at < this.history.length; at += direction) {
      if (this.eligible.includes(this.history[at])) return at;
    }
    return -1;
  }

  peek(eligible: readonly number[]): number {
    this.sync(eligible);
    const forward = this.adjacent(1);
    if (forward >= 0) return this.history[forward];
    if (!this.remaining.length) {
      this.remaining = this.mix([...eligible]);
      // A new round must not immediately repeat the last song of the old one.
      if (this.remaining.length > 1 && this.remaining[0] === this.history[this.cursor]) {
        const j = 1 + Math.floor(Math.random() * (this.remaining.length - 1));
        [this.remaining[0], this.remaining[j]] = [this.remaining[j], this.remaining[0]];
      }
    }
    return this.remaining[0] ?? -1;
  }

  previous(eligible: readonly number[]): number {
    this.sync(eligible);
    const back = this.adjacent(-1);
    if (back >= 0) return this.history[back];
    const current = this.history[this.cursor];
    return eligible.includes(current) ? current : this.peek(eligible);
  }

  played(index: number, backwards = false): void {
    const at = this.adjacent(backwards ? -1 : 1);
    if (at >= 0 && this.history[at] === index) { this.cursor = at; return; }
    if (backwards && this.history[this.cursor] === index) return;
    this.remaining = this.remaining.filter(i => i !== index);
    this.history.splice(this.cursor + 1);
    this.history.push(index);
    // Retain two rounds so Previous also works across a reshuffle, with memory
    // proportional to the folder rather than the length of the driving session.
    const limit = Math.max(1, this.eligible.length * 2);
    if (this.history.length > limit) this.history.splice(0, this.history.length - limit);
    this.cursor = this.history.length - 1;
  }
}

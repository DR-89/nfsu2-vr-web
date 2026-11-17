/** Native mod's master trim, shared by game sound, shift clicks and local media. */
export function masterGain(db:number):number {
  return 10**((Number.isFinite(db)?Math.max(-12,Math.min(12,db)):0)/20);
}

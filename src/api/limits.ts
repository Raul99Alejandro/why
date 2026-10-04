/** Fixed windows in memory: one Lambda instance may reset early, which only loosens the cap a little. */
export class Limits {
  private ip = new Map<string, { w: number; n: number }>();
  private day = { w: 0, n: 0 };
  constructor(private perIpPerHour: number, private perDay: number) {}
  take(ip: string, now: number): boolean {
    const h = Math.floor(now / 3_600_000), d = Math.floor(now / 86_400_000);
    const e = this.ip.get(ip);
    const ipN = e && e.w === h ? e.n : 0;
    const dayN = this.day.w === d ? this.day.n : 0;
    if (ipN >= this.perIpPerHour || dayN >= this.perDay) return false;
    this.ip.set(ip, { w: h, n: ipN + 1 });
    this.day = { w: d, n: dayN + 1 };
    return true;
  }
}

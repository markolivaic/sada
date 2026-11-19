/**
 * Keeps one request in flight. Requests made while one is out replace each other, and
 * only the newest is sent when the answer comes back. Dragging a slider then costs one
 * computation at a time, and the last position is always the one that ends up answered.
 */
export class LatestOnly<Request> {
  private readonly send: (request: Request) => void;
  private inFlight = false;
  private waiting: { request: Request } | null = null;

  constructor(send: (request: Request) => void) {
    this.send = send;
  }

  request(request: Request): void {
    if (this.inFlight) {
      this.waiting = { request };
      return;
    }
    this.inFlight = true;
    this.send(request);
  }

  /** Call when the answer to the request in flight has arrived. */
  settled(): void {
    this.inFlight = false;
    const next = this.waiting;
    this.waiting = null;
    if (next) this.request(next.request);
  }
}

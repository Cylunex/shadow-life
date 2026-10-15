# ADR 0002: Agent event trust boundary

Status: accepted.

The Runtime is an untrusted planner and text producer. It may emit only `message.delta`, `tool.requested`,
`input.required`, `run.completed`, or `run.interrupted`. It cannot announce that a run started and cannot
produce a committed tool receipt. Every Runtime event is validated again at the Host boundary even when the
configured adapter already validates its transport.

The Host owns the persisted and streamed event protocol. It emits `run.state`, `message.delta`, `tool.result`,
and `operation.committed`. An `operation.committed` event is created only after the shared Executor returns a
valid `shadow.execution-result`; it binds the authenticated subject, run, tool call, capability, command and
execution. Query results and rejected tool requests use `tool.result` and can never create a saved badge.

Run state is independent from operation state. A durable operation can therefore be followed by
`committed_partial` and then `interrupted` when the Runtime or connection fails. Clients retain that receipt,
recover later events by sequence, and never reinterpret partial model text as a completed run. Empty streams
also end in a persisted typed interruption.

The Host bounds Runtime events, tool calls, answer size, individual event size, transferred tool-result size,
and wall-clock duration. The run owner can request cancellation through the Host. Event persistence remains
authoritative when writing the live SSE connection fails.

The Host now also emits `tool.started` without full tool arguments. Recovery can replace an event whose
capability is no longer visible with `event.redacted`, retaining its sequence without exposing its result.
Public Host event schemas live in contracts; the adapter re-exports them for compatibility. Run pages expose
a bounded cursor and high-water mark, and clients drain committed receipts before accepting a final state.
See [snapshot and recovery architecture](../architecture/web-snapshots-and-run-recovery.md).

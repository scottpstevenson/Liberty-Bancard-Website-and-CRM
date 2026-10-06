// Neutral disposable-database slug: the conservative infrastructure guard
// rejects "prod" anywhere in a generated name, including "producer".
// This entry runs the complete producer suite, without changing any guard,
// database assertion, capability, provider denial or acceptance assertion.
await import("./test-stage3-b-work-producers");

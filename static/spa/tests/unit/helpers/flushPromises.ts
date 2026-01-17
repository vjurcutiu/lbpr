export async function flushPromises() {
  // Let pending microtasks resolve
  await Promise.resolve();
  await Promise.resolve();
}

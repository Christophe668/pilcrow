// Web entry point. AuthGate (in the root layout) redirects to
// /(auth)/server or /(app)/(library) based on session state; this
// file only exists so expo-router emits /index.html for the static
// build — the component itself never renders meaningful content.
export default function Index() {
  return null;
}

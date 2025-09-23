import LoginPage from "./LoginPage";

// Keep compatibility: anywhere the app still points to <AuthPage /> 
// will just render LoginPage.
export default function AuthPage() {
  return <LoginPage />;
}

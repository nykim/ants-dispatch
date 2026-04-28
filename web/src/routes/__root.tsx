import { createRootRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { isAuthenticated, login } from '../auth/cognito';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const { location } = useRouterState();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Public, unauthenticated routes — let the route component render
    // without sending the user through the Cognito redirect.
    const isAuthRoute = location.pathname.startsWith('/auth/');
    const isSubscribeRoute = location.pathname.startsWith('/subscribe');
    if (isAuthRoute || isSubscribeRoute) {
      setChecked(true);
      return;
    }
    if (!isAuthenticated()) {
      void login();
      return;
    }
    if (location.pathname === '/') {
      navigate({ to: '/compose', replace: true });
    }
    setChecked(true);
  }, [location.pathname, navigate]);

  if (!checked) {
    return (
      <div style={{ padding: 24, fontFamily: 'var(--serif)', color: 'var(--ink-mute)' }}>
        Signing you in…
      </div>
    );
  }
  return <Outlet />;
}

const routes = {};
let notFoundHandler = () => '<div class="page">Not found</div>';
let onNavigate = () => {};

export function registerRoute(path, renderFn) {
  routes[path] = renderFn;
}

export function setNotFound(fn) {
  notFoundHandler = fn;
}

export function onRouteChange(fn) {
  onNavigate = fn;
}

export function navigate(path) {
  if (location.hash === `#${path}`) {
    handleRoute();
  } else {
    location.hash = path;
  }
}

export function currentPath() {
  const hash = location.hash.replace(/^#/, '');
  return hash || '/';
}

function handleRoute() {
  const path = currentPath();
  const [base] = path.split('?');
  const renderFn = routes[base] || notFoundHandler;
  onNavigate(base);
  renderFn(document.getElementById('page-root'));
  window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

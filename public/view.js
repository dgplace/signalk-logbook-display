const MOBILE_BREAKPOINT_PX = 700;
const MIN_TOP_SECTION_HEIGHT = 230;
const MIN_MAP_SECTION_HEIGHT = 400;
const GRID_ROW_GAP_PX = 12;
const containerEl = document.querySelector('.container');
const mobileTabBar = document.getElementById('mobileTabBar');
const mobileTabButtons = {
  table: document.getElementById('mobileTabTable'),
  map: document.getElementById('mobileTabMap')
};
const tablePanel = document.getElementById('tablePanel');
const mapPanel = document.getElementById('mapPanel');

let pendingMobileResizeFrame = null;
let hasInitializedMobileView = false;
let mapResizeCallback = null;
let splittersInitialized = false;
let maximizeInitialized = false;

/**
 * Function: invalidateMapSize
 * Description: Invoke the registered map resize callback when layout changes require it.
 * Parameters: None.
 * Returns: void.
 */
function invalidateMapSize() {
  if (typeof mapResizeCallback === 'function') {
    mapResizeCallback();
  }
}

/**
 * Function: invalidateMapSizeDeferred
 * Description: Schedule a map resize callback on the next animation frame.
 * Parameters: None.
 * Returns: void.
 */
function invalidateMapSizeDeferred() {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => invalidateMapSize());
}

/**
 * Function: registerMapResizeCallback
 * Description: Register a callback invoked whenever layout changes require the map to resize.
 * Parameters:
 *   callback (Function|null): Function to call when the layout adjusts; pass null to clear.
 * Returns: void.
 */
export function registerMapResizeCallback(callback) {
  mapResizeCallback = typeof callback === 'function' ? callback : null;
}

/**
 * Function: isMobileViewport
 * Description: Determine whether the viewport width is below the mobile breakpoint.
 * Parameters: None.
 * Returns: boolean - True when the viewport should use the mobile layout.
 */
export function isMobileViewport() {
  const width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0;
  return width > 0 && width < MOBILE_BREAKPOINT_PX;
}

/**
 * Function: isMobileLayoutActive
 * Description: Determine whether the responsive mobile layout is currently applied.
 * Parameters: None.
 * Returns: boolean - True when the container is in mobile layout mode.
 */
export function isMobileLayoutActive() {
  return Boolean(containerEl && containerEl.classList.contains('mobile-layout'));
}

/**
 * Function: getActiveMobileView
 * Description: Read the currently selected mobile view from the container dataset.
 * Parameters: None.
 * Returns: string - Either 'table' or 'map'.
 */
export function getActiveMobileView() {
  if (!containerEl) return 'table';
  return containerEl.dataset.mobileView === 'map' ? 'map' : 'table';
}

/**
 * Function: setActiveMobileView
 * Description: Activate the requested mobile panel, update tab styling, and manage visibility.
 * Parameters:
 *   view (string): Target view identifier, accepts 'table' or 'map'.
 * Returns: void.
 */
export function setActiveMobileView(view) {
  if (!containerEl) return;
  const normalized = view === 'map' ? 'map' : 'table';
  containerEl.dataset.mobileView = normalized;
  const inMobileLayout = containerEl.classList.contains('mobile-layout');

  const tableButton = mobileTabButtons.table;
  const mapButton = mobileTabButtons.map;
  if (tableButton) {
    const isActive = normalized === 'table' && inMobileLayout;
    tableButton.classList.toggle('is-active', isActive);
    tableButton.setAttribute('aria-selected', String(isActive));
    tableButton.setAttribute('tabindex', inMobileLayout ? (normalized === 'table' ? '0' : '-1') : '0');
  }
  if (mapButton) {
    const isActive = normalized === 'map' && inMobileLayout;
    mapButton.classList.toggle('is-active', isActive);
    mapButton.setAttribute('aria-selected', String(isActive));
    mapButton.setAttribute('tabindex', inMobileLayout ? (normalized === 'map' ? '0' : '-1') : '0');
  }

  if (tablePanel) {
    tablePanel.hidden = inMobileLayout ? normalized !== 'table' : false;
  }
  if (mapPanel) {
    mapPanel.hidden = inMobileLayout ? normalized !== 'map' : false;
  }

  if (normalized === 'map') {
    invalidateMapSizeDeferred();
  }
}

/**
 * Function: ensureMobileMapView
 * Description: Activate the map tab when the mobile layout is active and scroll to the top when switching.
 * Parameters: None.
 * Returns: void.
 */
export function ensureMobileMapView() {
  if (!isMobileLayoutActive()) return;
  const previousView = getActiveMobileView();
  setActiveMobileView('map');
  if (previousView === 'map') return;
  if (typeof window === 'undefined') return;
  const scrollToTop = () => {
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(scrollToTop);
  } else {
    scrollToTop();
  }
}

/**
 * Function: ensureMobileLayoutReadiness
 * Description: Apply the mobile layout when the viewport qualifies and it has not yet been activated.
 * Parameters: None.
 * Returns: void.
 */
export function ensureMobileLayoutReadiness() {
  if (!isMobileViewport()) return;
  if (isMobileLayoutActive()) return;
  applyMobileLayout();
}

/**
 * Function: applyMobileLayout
 * Description: Toggle the responsive layout class and associated UI affordances based on viewport width.
 * Parameters: None.
 * Returns: void.
 */
export function applyMobileLayout() {
  if (!containerEl) return;
  const shouldUseMobile = isMobileViewport();
  if (shouldUseMobile) {
    containerEl.classList.add('mobile-layout');
    if (mobileTabBar) {
      mobileTabBar.hidden = false;
      mobileTabBar.setAttribute('aria-hidden', 'false');
    }
    containerEl.style.removeProperty('--top-height');
    containerEl.style.height = '';
    setActiveMobileView(getActiveMobileView());
  } else {
    containerEl.classList.remove('mobile-layout');
    if (mobileTabBar) {
      mobileTabBar.hidden = true;
      mobileTabBar.setAttribute('aria-hidden', 'true');
    }
    if (mobileTabButtons.table) {
      mobileTabButtons.table.classList.remove('is-active');
      mobileTabButtons.table.setAttribute('aria-selected', 'false');
      mobileTabButtons.table.setAttribute('tabindex', '0');
    }
    if (mobileTabButtons.map) {
      mobileTabButtons.map.classList.remove('is-active');
      mobileTabButtons.map.setAttribute('aria-selected', 'false');
      mobileTabButtons.map.setAttribute('tabindex', '0');
    }
    if (tablePanel) tablePanel.hidden = false;
    if (mapPanel) mapPanel.hidden = false;
    invalidateMapSizeDeferred();
  }
}

/**
 * Function: handleMobileTabKeyNavigation
 * Description: Support left and right arrow key navigation between mobile tabs.
 * Parameters:
 *   event (KeyboardEvent): Key event triggered within the mobile tab bar.
 * Returns: void.
 */
function handleMobileTabKeyNavigation(event) {
  if (!containerEl || !containerEl.classList.contains('mobile-layout')) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const currentView = getActiveMobileView();
  let nextView = currentView;
  if (event.key === 'ArrowLeft') {
    nextView = currentView === 'map' ? 'table' : 'map';
  } else if (event.key === 'ArrowRight') {
    nextView = currentView === 'table' ? 'map' : 'table';
  }
  if (nextView === currentView) return;
  event.preventDefault();
  setActiveMobileView(nextView);
  const nextButton = mobileTabButtons[nextView];
  if (nextButton) nextButton.focus();
}

/**
 * Function: initMobileLayoutControls
 * Description: Wire up mobile tab interactions and monitor viewport changes.
 * Parameters: None.
 * Returns: void.
 */
export function initMobileLayoutControls() {
  if (!containerEl) return;
  if (mobileTabButtons.table) {
    mobileTabButtons.table.addEventListener('click', () => setActiveMobileView('table'));
  }
  if (mobileTabButtons.map) {
    mobileTabButtons.map.addEventListener('click', () => setActiveMobileView('map'));
  }
  if (mobileTabBar) {
    mobileTabBar.addEventListener('keydown', handleMobileTabKeyNavigation);
  }
  window.addEventListener('resize', () => {
    if (pendingMobileResizeFrame) {
      cancelAnimationFrame(pendingMobileResizeFrame);
    }
    pendingMobileResizeFrame = requestAnimationFrame(() => {
      pendingMobileResizeFrame = null;
      applyMobileLayout();
    });
  });
  applyMobileLayout();
}

/**
 * Function: syncInitialMobileView
 * Description: Ensure the mobile layout is applied and default the first load to the map tab.
 * Parameters: None.
 * Returns: void.
 */
export function syncInitialMobileView() {
  const initializingMobileView = !hasInitializedMobileView;
  applyMobileLayout();
  if (initializingMobileView) {
    hasInitializedMobileView = true;
    setActiveMobileView('map');
  }
}

/**
 * Function: initSplitters
 * Description: Initialize drag controls for resizing the top/table section height.
 * Parameters: None.
 * Returns: void.
 */
export function initSplitters() {
  if (splittersInitialized) return;
  const container = document.querySelector('.container');
  const top = document.querySelector('.top-section');
  const hDivider = document.getElementById('hDivider');
  if (!container || !top || !hDivider) return;
  splittersInitialized = true;

  let hDragging = false;
  let hStartY = 0;
  let hStartHeight = 0;

  const onHMove = (clientY) => {
    const dy = clientY - hStartY;
    const containerRect = container.getBoundingClientRect();
    let newHeight = hStartHeight + dy;
    const dividerHeight = hDivider.getBoundingClientRect().height || 0;
    const maxAvailable = containerRect.height - MIN_MAP_SECTION_HEIGHT - dividerHeight - GRID_ROW_GAP_PX;
    const maxHeight = Math.max(MIN_TOP_SECTION_HEIGHT, maxAvailable);
    if (newHeight < MIN_TOP_SECTION_HEIGHT) newHeight = MIN_TOP_SECTION_HEIGHT;
    if (newHeight > maxHeight) newHeight = maxHeight;
    container.style.setProperty('--top-height', `${newHeight}px`);
    invalidateMapSizeDeferred();
  };

  hDivider.addEventListener('mousedown', (event) => {
    hDragging = true;
    hStartY = event.clientY;
    hStartHeight = top.getBoundingClientRect().height;
    document.body.classList.add('resizing');
    event.preventDefault();
  });

  window.addEventListener('mousemove', (event) => {
    if (!hDragging) return;
    onHMove(event.clientY);
  });

  window.addEventListener('mouseup', () => {
    if (!hDragging) return;
    hDragging = false;
    document.body.classList.remove('resizing');
    invalidateMapSizeDeferred();
  });

  hDivider.addEventListener('touchstart', (event) => {
    if (!event.touches || event.touches.length === 0) return;
    hDragging = true;
    hStartY = event.touches[0].clientY;
    hStartHeight = top.getBoundingClientRect().height;
    document.body.classList.add('resizing');
    event.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', (event) => {
    if (!hDragging || !event.touches || event.touches.length === 0) return;
    onHMove(event.touches[0].clientY);
    event.preventDefault();
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (!hDragging) return;
    hDragging = false;
    document.body.classList.remove('resizing');
    invalidateMapSizeDeferred();
  });
}

/**
 * Function: initMaximizeControl
 * Description: Initialize the maximize/restore toggle for the voyage table.
 * Parameters: None.
 * Returns: void.
 */
export function initMaximizeControl() {
  if (maximizeInitialized) return;
  const btn = document.getElementById('toggleMaxBtn');
  const container = document.querySelector('.container');
  const top = document.querySelector('.top-section');
  const wrapper = document.querySelector('.table-wrapper');
  const headerBar = document.querySelector('.header-bar');
  const hDivider = document.getElementById('hDivider');
  if (!btn || !container || !top) return;
  maximizeInitialized = true;

  let maximized = false;

  const update = () => {
    if (maximized) {
      const thead = document.querySelector('#voyTable thead');
      const tbody = document.querySelector('#voyTable tbody');
      const wrapStyles = wrapper ? getComputedStyle(wrapper) : null;
      const borders = wrapStyles ? (parseFloat(wrapStyles.borderTopWidth || '0') + parseFloat(wrapStyles.borderBottomWidth || '0')) : 0;
      const paddings = wrapStyles ? (parseFloat(wrapStyles.paddingTop || '0') + parseFloat(wrapStyles.paddingBottom || '0')) : 0;
      const headerHeight = headerBar ? headerBar.getBoundingClientRect().height : 0;
      const headHeight = thead ? thead.getBoundingClientRect().height : 0;
      const bodyHeight = tbody ? tbody.scrollHeight : 0;
      const requiredTopHeight = Math.max(MIN_TOP_SECTION_HEIGHT, Math.ceil(headerHeight + headHeight + bodyHeight + borders + paddings + 2));
      const containerRect = container.getBoundingClientRect();
      const currentTopHeight = top.getBoundingClientRect().height;
      const delta = Math.max(0, requiredTopHeight - currentTopHeight);
      container.style.height = `${Math.ceil(containerRect.height + delta)}px`;
      container.style.setProperty('--top-height', `${requiredTopHeight}px`);
      btn.textContent = 'Restore';
      btn.setAttribute('aria-pressed', 'true');
    } else {
      container.style.height = '';
      container.style.removeProperty('--top-height');
      btn.textContent = 'Maximize';
      btn.setAttribute('aria-pressed', 'false');
    }
    invalidateMapSizeDeferred();
  };

  btn.addEventListener('click', () => {
    maximized = !maximized;
    update();
  });

  update();
}

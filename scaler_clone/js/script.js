/* Scaler landing page — interactive bits
 * Author: Rajveer Bishnoi
 */

// Toggle the elevated header shadow once the page is scrolled past the top.
const siteHeader = document.getElementById('site-header');
if (siteHeader) {
  const SCROLL_THRESHOLD = 12;
  window.addEventListener('scroll', () => {
    siteHeader.classList.toggle('scrolled', window.scrollY > SCROLL_THRESHOLD);
  }, { passive: true });
}

// Mobile menu open/close + dismissal behavior.
const menuButton = document.getElementById('hamburger');
const mobileNav = document.getElementById('nav-mobile');

if (menuButton && mobileNav) {
  menuButton.addEventListener('click', () => {
    const isExpanded = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', !isExpanded);
    mobileNav.hidden = isExpanded;
  });
}

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

function closeMobileNav() {
  if (!mobileNav || !menuButton) return;
  mobileNav.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.classList.remove('open');
}

if (menuButton && mobileNav) {
  menuButton.addEventListener('click', () => {
    const willOpen = mobileNav.hidden;
    mobileNav.hidden = !willOpen;
    menuButton.setAttribute('aria-expanded', String(willOpen));
    menuButton.classList.toggle('open', willOpen);
  });

  // Tapping a link inside the panel should collapse it.
  mobileNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMobileNav);
  });

  // Anywhere outside the header? Collapse too.
  document.addEventListener('click', (event) => {
    if (siteHeader && !siteHeader.contains(event.target)) {
      closeMobileNav();
    }
  });
}

// Keyboard support for the desktop dropdowns.
document.querySelectorAll('.nav-dropdown').forEach((dropdown) => {
  const trigger = dropdown.querySelector('.nav-btn');
  const panel = dropdown.querySelector('.dropdown-menu');
  if (!trigger || !panel) return;

  const setOpen = (open) => {
    trigger.setAttribute('aria-expanded', String(open));
    panel.style.display = open ? 'flex' : 'none';
  };

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      setOpen(!expanded);
    } else if (event.key === 'Escape') {
      setOpen(false);
      trigger.focus();
    }
  });

  panel.querySelectorAll('.dropdown-item').forEach((item) => {
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.focus();
      }
    });
  });

  dropdown.addEventListener('focusout', (event) => {
    if (!dropdown.contains(event.relatedTarget)) {
      trigger.setAttribute('aria-expanded', 'false');
      panel.style.display = '';
    }
  });
});

// Smooth-scroll for in-page anchor links.
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (event) => {
    const href = anchor.getAttribute('href');
    if (!href || href === '#') return;
    const target = document.querySelector(href);
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Reveal floating hero badges as they enter the viewport, with a subtle stagger.
const floatingBadges = document.querySelectorAll('.float-badge');
if (floatingBadges.length) {
  const badgeObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (!entry.isIntersecting) return;
      window.setTimeout(() => {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }, index * 180);
      badgeObserver.unobserve(entry.target);
    });
  }, { threshold: 0.1 });

  floatingBadges.forEach((badge) => {
    badge.style.opacity = '0';
    badge.style.transform = 'translateY(14px)';
    badge.style.transition = 'opacity 0.55s ease, transform 0.55s ease';
    badgeObserver.observe(badge);
  });
}

// Reveal feature/program/testimonial cards as they enter the viewport.
const revealTargets = document.querySelectorAll('.feature-card, .program-card, .testimonial, .big-stat');
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (revealTargets.length) {
  if (reduceMotion) {
    revealTargets.forEach((el) => el.classList.add('is-revealed'));
  } else {
    revealTargets.forEach((el) => el.classList.add('reveal-init'));
    const cardObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (!entry.isIntersecting) return;
        const delay = Math.min(index * 80, 320);
        entry.target.style.transitionDelay = `${delay}ms`;
        entry.target.classList.add('is-revealed');
        cardObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealTargets.forEach((card) => cardObserver.observe(card));
  }
}

// Fade in the company name strip with a small per-item delay.
const partnerLogos = document.querySelectorAll('.company-name');
if (partnerLogos.length) {
  const logoObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
      logoObserver.unobserve(entry.target);
    });
  }, { threshold: 0.2 });

  partnerLogos.forEach((logo, index) => {
    logo.style.opacity = '0';
    logo.style.transform = 'translateY(10px)';
    logo.style.transition = `opacity 0.45s ease ${index * 70}ms, transform 0.45s ease ${index * 70}ms`;
    logoObserver.observe(logo);
  });
}

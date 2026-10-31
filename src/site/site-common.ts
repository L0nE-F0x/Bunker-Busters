/** Shared by the landing page (site.ts), the press kit and the privacy page (site-pages.ts). (Files here
 * start with "site-" so their build chunks stay out of the game's offline cache: vite.config.ts.) */

let io: IntersectionObserver | null = null;

/**
 * Fade `.reveal` elements in as they scroll into view. The hidden state only exists under `html.js`
 * (set by an inline script in each page's head) and without reduced motion, so the content shows when
 * scripts are off; each page's head takes the class off again after 4 s unless this has run. Call it
 * again with a container after adding more `.reveal` elements.
 */
export function revealOnScroll(root: ParentNode = document) {
  const els = [...root.querySelectorAll<HTMLElement>('.reveal')];
  if (typeof IntersectionObserver === 'undefined') els.forEach((e) => e.classList.add('in'));
  else {
    io ??= new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io!.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    for (const el of els) io.observe(el);
  }
  (window as unknown as { __bbSite?: boolean }).__bbSite = true;
}

/** The fixed nav gets its solid background once the page has scrolled. */
export function solidNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const on = () => nav.classList.toggle('solid', scrollY > 40);
  addEventListener('scroll', on, { passive: true });
  on();
}

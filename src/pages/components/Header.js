/** The top navigation bar shared by every signed-in page. Handles the collapsed mobile menu. */
export class Header {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.root = page.locator('#app-header');
    this.menuToggle = page.getByTestId('menu-toggle');
    this.nav = page.getByRole('navigation', { name: 'Main' });
    this.userName = page.getByTestId('user-name');
    this.logoutButton = page.getByTestId('logout-button');
    // The highlighted link; located by attribute so it also works while the mobile menu is collapsed.
    this.currentLink = page.locator('#main-nav a[aria-current="page"]');
  }

  async #openMenuIfCollapsed() {
    if (await this.menuToggle.isVisible()) {
      if ((await this.menuToggle.getAttribute('aria-expanded')) !== 'true') await this.menuToggle.click();
    }
  }

  navLink(name) {
    return this.nav.getByRole('link', { name, exact: true });
  }

  async navigateTo(name) {
    await this.#openMenuIfCollapsed();
    await this.navLink(name).click();
  }

  async logout() {
    await this.#openMenuIfCollapsed();
    await this.logoutButton.click();
  }
}

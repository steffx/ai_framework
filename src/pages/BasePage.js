import { Header } from './components/Header.js';

export class BasePage {
  /** Relative URL of the page; subclasses override it. */
  path = '/';

  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.header = new Header(page);
    this.toast = page.getByTestId('toast');
  }

  async goto() {
    await this.page.goto(this.path);
    await this.waitUntilReady();
  }

  /** Subclasses wait for whatever proves the page finished loading its data. */
  async waitUntilReady() {}
}

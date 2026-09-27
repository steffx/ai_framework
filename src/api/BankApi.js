/**
 * Thin client over the NovaPay HTTP API, used for fast test setup
 * (create customers, seed transfers, read one-time codes) so UI tests
 * only spend browser time on the behaviour they actually verify.
 */
export class BankApi {
  /** @param {import('@playwright/test').APIRequestContext} request */
  constructor(request) {
    this.request = request;
  }

  async #json(response, expectedStatus) {
    if (expectedStatus && response.status() !== expectedStatus) {
      throw new Error(`${response.url()} returned ${response.status()}: ${await response.text()}`);
    }
    return response.json();
  }

  /** Creates a fresh, isolated customer. Returns { username, password }. */
  async createCustomer({ checking = 2500, savings = 10000, name = 'Alex Morgan' } = {}) {
    return this.#json(await this.request.post('/api/test/users', { data: { checking, savings, name } }), 201);
  }

  async login({ username, password }) {
    return this.request.post('/api/login', { data: { username, password } });
  }

  async me() {
    return this.#json(await this.request.get('/api/me'), 200);
  }

  async checkingAccount() {
    const me = await this.me();
    return me.accounts.find((a) => a.type === 'Checking');
  }

  async transfer({ recipientName, recipientIban, amount, description = '', fromAccountId }) {
    const accountId = fromAccountId ?? (await this.checkingAccount()).id;
    return this.request.post('/api/transfers', {
      data: { fromAccountId: accountId, recipientName, recipientIban, amount: String(amount), description },
    });
  }

  async otpFor(transactionId) {
    const body = await this.#json(await this.request.get(`/api/test/otp/${transactionId}`), 200);
    return body.code;
  }

  async confirmOtp(transactionId, code) {
    return this.request.post(`/api/transfers/${transactionId}/otp`, { data: { code } });
  }

  async setCardFrozen(frozen) {
    return this.#json(await this.request.post('/api/card/freeze', { data: { frozen } }), 200);
  }

  async transactions(params = {}) {
    return this.#json(await this.request.get('/api/transactions', { params }), 200);
  }

  async alerts() {
    return this.#json(await this.request.get('/api/alerts'), 200);
  }

  async scoreFraud(context, apiKey = process.env.FRAUD_API_KEY || 'local-dev-key') {
    return this.request.post('/api/fraud/score', { data: context, headers: { 'x-api-key': apiKey } });
  }
}

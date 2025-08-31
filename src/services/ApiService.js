const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? process.env.REACT_APP_API_URL || 'https://job-community-app-production.up.railway.app'
  : 'http://localhost:5000';

class ApiService {
  static async makeRequest(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    
    const defaultHeaders = {
      'Content-Type': 'application/json',
    };
    
    if (user.token) {
      defaultHeaders.Authorization = `Bearer ${user.token}`;
    }
    
    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };
    
    const response = await fetch(url, config);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.json();
  }

  // Authentication
  static async login(email, password) {
    return this.makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  static async register(userData) {
    return this.makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  // Companies
  static async getCompanies() {
    return this.makeRequest('/api/companies');
  }

  static async getCompany(companyId) {
    return this.makeRequest(`/api/companies/${companyId}`);
  }

  static async createCompany(companyData) {
    return this.makeRequest('/api/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });
  }

  static async seedCompanies() {
    return this.makeRequest('/api/companies/seed', {
      method: 'POST',
    });
  }

  // Messages
  static async getMessages(companyId) {
    return this.makeRequest(`/api/messages/${companyId}`);
  }

  static async sendMessage(messageData) {
    return this.makeRequest('/api/messages', {
      method: 'POST',
      body: JSON.stringify(messageData),
    });
  }

  static async deleteMessage(messageId) {
    return this.makeRequest(`/api/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  static async editMessage(messageId, messageData) {
    return this.makeRequest(`/api/messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify(messageData),
    });
  }

  static async clearMessages(companyId) {
    return this.makeRequest(`/api/messages/clear/${companyId}`, {
      method: 'DELETE',
    });
  }

  static async clearGroupMessages(groupId) {
    return this.makeRequest(`/api/messages/clear/group/${groupId}`, {
      method: 'DELETE',
    });
  }

  
  static async sendGroupMessage(groupId, messageData) {
    return this.makeRequest(`/api/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify(messageData),
    });
  }

  static async getGroupMessages(groupId) {
    return this.makeRequest(`/api/groups/${groupId}/messages`);
  }

  // User management
  static async joinCompany(companyId) {
    return this.makeRequest(`/api/companies/${companyId}/join`, {
      method: 'POST',
    });
  }

  static async leaveCompany(companyId) {
    return this.makeRequest(`/api/companies/${companyId}/leave`, {
      method: 'POST',
    });
  }
}

export default ApiService;

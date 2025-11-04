export const renderHeader = (): string => {
  return `
        <div class="navigation-header">
            <a href="/" class="nav-link">Dashboard</a>
            <a href="/tools" class="nav-link">Tools</a>
            <a href="/services" class="nav-link">Services</a>
            <a href="/endpoints" class="nav-link">Endpoints</a>
            <a href="/category" class="nav-link">Categories</a>
            <a href="/logs" class="nav-link">Logs</a>
        </div>`;
};

export const getHeaderStyles = (): string => {
  return `
        .navigation-header {
            margin-bottom: 30px;
            padding: 15px 0;
            border-bottom: 2px solid #dee2e6;
        }
        .nav-link {
            background-color: #6c757d;
            color: white;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 0.9em;
            transition: background-color 0.2s ease;
        }
        .nav-link:hover {
            background-color: #5a6268;
            text-decoration: none;
            color: white;
        }`;
};

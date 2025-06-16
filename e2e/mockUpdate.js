export async function setupMockUpdateRoute(page) {
    await page.route('https://api.github.com/**', (route) => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                tag_name: 'v1.1.0',
                html_url: 'https://example.com/release/v1.1.0'
            })
        });
    });
}

export async function removeMockUpdateRoute(page) {
    await page.unroute('https://api.github.com/**');
}

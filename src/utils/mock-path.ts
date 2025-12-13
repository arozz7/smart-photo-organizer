const mockPath = {
    join: (...args: string[]) => args.join('/'),
    dirname: (path: string) => path.split('/').slice(0, -1).join('/') || '.',
    resolve: (...args: string[]) => args.join('/'),
    basename: (path: string) => path.split('/').pop() || '',
    extname: (path: string) => {
        const parts = path.split('.');
        return parts.length > 1 ? '.' + parts.pop() : '';
    },
    sep: '/'
};

export default mockPath;

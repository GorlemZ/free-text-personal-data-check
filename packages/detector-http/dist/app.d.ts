import type { RequestListener } from "node:http";
export type DetectorRoutes = Readonly<{
    health: RequestListener;
    analyze: RequestListener;
    notFound: RequestListener;
}>;
export declare function createDetectorApp(routes: DetectorRoutes): RequestListener;

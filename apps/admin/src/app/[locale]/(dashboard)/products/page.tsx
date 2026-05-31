import { serverCaller } from "@/server/caller";
import { ProductsClient } from "./ProductsClient";

export default async function ProductsPage() {
    const caller = await serverCaller();

    const [productsResponse, categoriesResponse] = await Promise.all([
        caller.products.list({ page: 1, pageSize: 50 }),
        caller.categories.list()
    ]);

    if (productsResponse.error) {
        return <div dir="rtl" className="font-cairo text-[var(--crimson)]">Error loading products</div>;
    }
    
    if (categoriesResponse.error) {
         return <div dir="rtl" className="font-cairo text-[var(--crimson)]">Error loading categories</div>;
    }

    return (
        <ProductsClient 
            products={productsResponse.data} 
            categories={categoriesResponse.data} 
        />
    );
}

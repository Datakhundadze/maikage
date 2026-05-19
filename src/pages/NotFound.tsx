import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import SeoHead from "@/components/SeoHead";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <SeoHead
        title="გვერდი ვერ მოიძებნა (404) | Maika.ge"
        description="მოთხოვნილი გვერდი არ არსებობს ან გადატანილია. დაბრუნდი მთავარ გვერდზე ან გადახედე ჩვენს კატალოგს."
        noindex
      />
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;

import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ContentEditor from "./ContentEditor";
import BlogGenerator from "./BlogGenerator";
import SocialComposer from "./SocialComposer";
import BlazeIntegration from "./BlazeIntegration";

export default function ContentHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const validTabs = isAdmin
    ? ["content", "blog", "linkedin", "blaze"]
    : ["content", "linkedin", "blaze"];

  const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
  const tab = validTabs.includes(raw) ? raw : "content";
  const [, navigate] = useLocation();
  const goTab = (v: string) => navigate(`/dashboard/content-hub?tab=${v}`);

  return (
    <Tabs value={tab} onValueChange={goTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="content" data-testid="tab-content-engine">Content Engine</TabsTrigger>
        {isAdmin && <TabsTrigger value="blog" data-testid="tab-content-blog">Blog Generator</TabsTrigger>}
        <TabsTrigger value="linkedin" data-testid="tab-content-linkedin">LinkedIn</TabsTrigger>
        <TabsTrigger value="blaze" data-testid="tab-content-blaze">Blaze.ai</TabsTrigger>
      </TabsList>
      <TabsContent value="content"><ContentEditor /></TabsContent>
      {isAdmin && <TabsContent value="blog"><BlogGenerator /></TabsContent>}
      <TabsContent value="linkedin"><SocialComposer /></TabsContent>
      <TabsContent value="blaze"><BlazeIntegration /></TabsContent>
    </Tabs>
  );
}

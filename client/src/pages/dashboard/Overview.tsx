import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useContacts } from "@/hooks/use-contacts";
import { useTickets } from "@/hooks/use-tickets";
import { Users, Ticket, DollarSign, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Overview() {
  const { data: contacts } = useContacts();
  const { data: tickets } = useTickets();

  const totalContacts = contacts?.length || 0;
  const activeTickets = tickets?.filter(t => t.status !== "Closed").length || 0;
  
  // Mock chart data
  const data = [
    { name: 'Jan', value: 400 },
    { name: 'Feb', value: 300 },
    { name: 'Mar', value: 600 },
    { name: 'Apr', value: 800 },
    { name: 'May', value: 500 },
    { name: 'Jun', value: 900 },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Leads</CardTitle>
            <Users className="w-4 h-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalContacts}</div>
            <p className="text-xs text-muted-foreground mt-1">+20.1% from last month</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Tickets</CardTitle>
            <Ticket className="w-4 h-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeTickets}</div>
            <p className="text-xs text-muted-foreground mt-1">3 high priority</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Revenue</CardTitle>
            <DollarSign className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$45,231.89</div>
            <p className="text-xs text-muted-foreground mt-1">+15% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Growth</CardTitle>
            <TrendingUp className="w-4 h-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+12.5%</div>
            <p className="text-xs text-muted-foreground mt-1">Year over Year</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Sales Velocity</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                <Tooltip 
                  cursor={{ fill: '#f3f4f6' }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                />
                <Bar dataKey="value" fill="hsl(221, 83%, 53%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {contacts?.slice(0, 5).map((contact) => (
                <div key={contact.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                      {contact.firstName[0]}{contact.lastName[0]}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{contact.firstName} {contact.lastName}</div>
                      <div className="text-xs text-muted-foreground">{contact.companyName}</div>
                    </div>
                  </div>
                  <div className={`text-xs px-2 py-1 rounded-full font-medium ${
                    contact.status === 'New' ? 'bg-blue-100 text-blue-700' : 
                    contact.status === 'Qualified' ? 'bg-green-100 text-green-700' : 
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {contact.status}
                  </div>
                </div>
              ))}
              {(!contacts || contacts.length === 0) && (
                <div className="text-center text-muted-foreground py-8">No recent contacts</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

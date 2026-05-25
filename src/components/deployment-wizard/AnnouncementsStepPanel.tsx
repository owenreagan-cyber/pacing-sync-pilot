 
import AnnouncementCenterPage from '@/pages/AnnouncementCenterPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AnnouncementsStepPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 4: Announcement Review & Deploy</CardTitle>
      </CardHeader>
      <CardContent>
        <AnnouncementCenterPage />
      </CardContent>
    </Card>
  );
}

import FileOrganizerPage from '@/pages/FileOrganizerPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function FileOrganizerStepPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 1: File Organizer & Mapping</CardTitle>
      </CardHeader>
      <CardContent>
        <FileOrganizerPage />
      </CardContent>
    </Card>
  );
}

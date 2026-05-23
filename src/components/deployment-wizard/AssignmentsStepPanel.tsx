import AssignmentsPage from '@/pages/AssignmentsPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AssignmentsStepPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2: Assignment Review & Deploy</CardTitle>
      </CardHeader>
      <CardContent>
        <AssignmentsPage />
      </CardContent>
    </Card>
  );
}
